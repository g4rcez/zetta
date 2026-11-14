import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getPlugin, PluginError, type PluginContext } from "../registry";
import { configureGoogleForTests } from "./oauth";
import { configureGoogleLoopback, resetLoopback } from "./loopback";
import "./index";

let challenge = "";
const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const body = await req.text();
    if (u.pathname === "/token") {
      const f = new URLSearchParams(body);
      const ok =
        createHash("sha256")
          .update(f.get("code_verifier") ?? "")
          .digest("base64url") === challenge;
      return ok
        ? Response.json({
            access_token: "acc-1",
            refresh_token: "ref-1",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          })
        : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (u.pathname === "/userinfo") return Response.json({ email: `${userEmail}@example.com` });
    return new Response("no", { status: 404 });
  },
});
const base = `http://localhost:${fake.port}`;
let userEmail = "me";
let now = 1_000_000;
afterAll(() => {
  fake.stop(true);
  resetLoopback();
  configureGoogleForTests({});
});

const plugin = getPlugin("google")!;
const users = new Map<string, { readonly config: Record<string, string>; ctx: PluginContext }>();
function user(id: string) {
  let held = users.get(id);
  if (!held) {
    const box = {
      config: {
        clientId: "cid",
        clientSecret: "csecret",
        clientType: "desktop",
      } as Record<string, string>,
    };
    const ctx: PluginContext = {
      userId: id,
      actorUserId: id,
      get config() {
        return box.config;
      },
      async setConfig(n) {
        box.config = { ...n };
      },
    };
    held = {
      get config() {
        return box.config;
      },
      ctx,
    };
    users.set(id, held);
  }
  return held!;
}
const accountsOf = (id: string) =>
  JSON.parse(user(id).config.accounts ?? "[]") as { email: string }[];

let failWith: unknown;
beforeEach(() => {
  users.clear();
  userEmail = "me";
  now = 1_000_000;
  failWith = undefined;
  configureGoogleForTests({
    authUrl: `${base}/auth`,
    tokenUrl: `${base}/token`,
    userinfoUrl: `${base}/userinfo`,
    loopbackPort: 0,
    now: () => now,
  });
  configureGoogleLoopback({
    webOrigin: "https://zetta.test/",
    complete: async (userId, params) => {
      if (failWith) throw failWith;
      await plugin.callback!(user(userId).ctx, params);
    },
  });
});

async function start(id = "u1") {
  const r = (await plugin.connect!(user(id).ctx, { scopes: ["gmail.readonly"] })) as {
    authorizeUrl: string;
    data?: { completion?: string };
  };
  const u = new URL(r.authorizeUrl);
  challenge = u.searchParams.get("code_challenge")!;
  const redirect = new URL(u.searchParams.get("redirect_uri")!);
  return { state: u.searchParams.get("state")!, redirect, data: r.data };
}
const hit = (redirect: URL, query: string, init: RequestInit = {}) =>
  fetch(`${redirect.origin}/${query}`, { redirect: "manual", ...init });

describe("google loopback listener", () => {
  test("the redirect on this computer finishes the sign-in and sends the browser back to the plugin page", async () => {
    const { state, redirect, data } = await start();
    expect(data).toEqual({ completion: "paste" }); // the paste step stays as the fallback
    expect(redirect.hostname).toBe("127.0.0.1");
    expect(Number(redirect.port)).toBeGreaterThan(0);
    const res = await hit(redirect, `?state=${state}&code=c1&iss=https://accounts.google.com`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://zetta.test/plugins/google?plugin=google&status=ok",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(accountsOf("u1")).toMatchObject([{ email: "me@example.com" }]);
  });

  test("unknown state, other paths and other methods get a bare 404 and leave the sign-in usable", async () => {
    const { state, redirect } = await start();
    expect((await hit(redirect, "?state=forged&code=c")).status).toBe(404);
    expect((await hit(redirect, "?code=c")).status).toBe(404);
    expect((await fetch(`${redirect.origin}/favicon.ico`)).status).toBe(404);
    expect(
      (await fetch(`${redirect.origin}/?state=${state}&code=c1`, { method: "POST" })).status,
    ).toBe(404);
    expect(accountsOf("u1")).toEqual([]);
    expect((await hit(redirect, `?state=${state}&code=c1`)).status).toBe(303);
    expect(accountsOf("u1")).toHaveLength(1);
  });

  test("a state works once", async () => {
    const { state, redirect } = await start();
    expect((await hit(redirect, `?state=${state}&code=c1`)).status).toBe(303);
    // The listener closes with the last sign-in; a new one brings it back, and the used state is gone either way.
    const again = await start();
    expect((await hit(again.redirect, `?state=${state}&code=c1`)).status).toBe(404);
  });

  test("an expired state is refused", async () => {
    const { state, redirect } = await start();
    now += 11 * 60_000;
    expect((await hit(redirect, `?state=${state}&code=c1`)).status).toBe(404);
    expect(accountsOf("u1")).toEqual([]);
  });

  test("each state finishes the sign-in of the user who started it", async () => {
    const a = await start("u1");
    userEmail = "other";
    const b = await start("u2");
    expect(a.redirect.port).toBe(b.redirect.port); // one listener for everyone
    expect((await hit(b.redirect, `?state=${b.state}&code=c2`)).status).toBe(303);
    expect(accountsOf("u2")).toMatchObject([{ email: "other@example.com" }]);
    expect(accountsOf("u1")).toEqual([]);
  });

  test("a refusal during the exchange goes back to the page with the reason", async () => {
    const { state, redirect } = await start();
    failWith = new PluginError("ACCESS_DENIED", "declined");
    const res = await hit(redirect, `?state=${state}&error=access_denied`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://zetta.test/plugins/google?plugin=google&status=error&reason=ACCESS_DENIED",
    );
    failWith = undefined;
  });

  test("an unexpected failure shows a generic reason", async () => {
    const { state, redirect } = await start();
    failWith = new Error("db password is hunter2");
    const res = await hit(redirect, `?state=${state}&code=c1`);
    expect(res.headers.get("location")).toContain("reason=UNAVAILABLE");
    expect(res.headers.get("location")).not.toContain("hunter2");
    failWith = undefined;
  });

  test("a taken port is not an error: the redirect is the same and the address is pasted", async () => {
    const busy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("other app"),
    });
    try {
      configureGoogleForTests({
        authUrl: `${base}/auth`,
        tokenUrl: `${base}/token`,
        userinfoUrl: `${base}/userinfo`,
        loopbackPort: busy.port ?? 0,
        now: () => now,
      });
      configureGoogleLoopback({ webOrigin: "https://zetta.test", complete: async () => {} });
      const { redirect, data } = await start();
      expect(Number(redirect.port)).toBe(busy.port ?? 0);
      expect(data).toEqual({ completion: "paste" });
    } finally {
      busy.stop(true);
    }
  });

  test("without the services wiring there is no listener and the sign-in still starts", async () => {
    resetLoopback();
    const { redirect, data } = await start();
    expect(data).toEqual({ completion: "paste" });
    await expect(hit(redirect, "?state=x&code=c")).rejects.toBeDefined();
  });

  test("status reports a waiting sign-in until it finishes, without any secret", async () => {
    const { state, redirect } = await start();
    const waiting = await plugin.status!(user("u1").ctx);
    expect(waiting.state).toBe("needs-auth");
    expect((waiting.info as { signIn?: { completion: string } }).signIn?.completion).toBe("paste");
    expect(JSON.stringify(waiting)).not.toContain(state);
    await hit(redirect, `?state=${state}&code=c1`);
    const done = await plugin.status!(user("u1").ctx);
    expect(done.state).toBe("connected");
    expect((done.info as { signIn?: unknown }).signIn).toBeUndefined();
  });

  test("status forgets an expired sign-in", async () => {
    await start();
    now += 11 * 60_000;
    const s = await plugin.status!(user("u1").ctx);
    expect((s.info as { signIn?: unknown } | undefined)?.signIn).toBeUndefined();
  });
});

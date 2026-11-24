import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getPlugin, type PluginContext } from "../registry";
import { pastedParams } from "../pasted-redirect";
import { configureMicrosoftForTests, redirectUri } from "./oauth";
import "./index";

/**
 * The Microsoft plugin's sign-in against a fake Microsoft identity platform and a fake Graph `/me`. A real Microsoft account was NOT
 * used; the shapes are the ones in Microsoft's documentation (learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow).
 */

let tokenForms: { path: string; form: URLSearchParams }[] = [];
let challenge = "";
let scopeReply = "Mail.Read Mail.Send User.Read openid profile";
let profile: { mail?: string | null; userPrincipalName?: string } = { mail: "Me@Example.invalid" };
let tokenMode: "ok" | "invalid_grant" | "interaction_required" | "down" = "ok";
let tokenCount = 0;
const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const body = await req.text();
    if (u.pathname.endsWith("/oauth2/v2.0/token")) {
      const form = new URLSearchParams(body);
      tokenForms.push({ path: u.pathname, form });
      if (form.get("grant_type") === "authorization_code") {
        const ok =
          createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url") === challenge;
        return ok
          ? Response.json({
              access_token: "acc-1",
              refresh_token: "ref-1",
              expires_in: 3600,
              scope: scopeReply,
            })
          : Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      tokenCount++;
      if (tokenMode === "down") return new Response("x", { status: 503 });
      if (tokenMode !== "ok") return Response.json({ error: tokenMode }, { status: 400 });
      return Response.json({
        access_token: `acc-r${tokenCount}`,
        refresh_token: `ref-r${tokenCount}`,
        expires_in: 3600,
      });
    }
    if (u.pathname === "/v1.0/me") return Response.json(profile);
    return new Response("no", { status: 404 });
  },
});
const base = `http://localhost:${fake.port}`;
afterAll(() => {
  fake.stop(true);
  configureMicrosoftForTests({});
});

const CID = "00000000-0000-0000-0000-000000000000";
function mkCtx(userId = "u1", start: Record<string, string> = {}) {
  let config: Record<string, string> = { clientId: CID, clientType: "desktop", ...start };
  const ctx: PluginContext = {
    userId,
    get config() {
      return config;
    },
    async setConfig(n) {
      config = { ...n };
    },
  };
  return { ctx, get: () => config };
}
const plugin = getPlugin("microsoft")!;
const accountsOf = (c: { get: () => Record<string, string> }) =>
  JSON.parse(c.get().accounts ?? "[]") as Record<string, string>[];
let now = 1_000_000;
beforeEach(() => {
  tokenForms = [];
  tokenCount = 0;
  tokenMode = "ok";
  scopeReply = "Mail.Read Mail.Send User.Read openid profile";
  profile = { mail: "Me@Example.invalid" };
  now = 1_000_000;
  process.env.ZETTA_OAUTH_REDIRECT_BASE = "https://zetta.test";
  configureMicrosoftForTests({ loginBase: base, graphBase: `${base}/v1.0`, now: () => now });
});

async function start(c: ReturnType<typeof mkCtx>, options: Record<string, unknown>) {
  const r = (await plugin.connect!(c.ctx, options)) as {
    authorizeUrl: string;
    data?: Record<string, unknown>;
  };
  const u = new URL(r.authorizeUrl);
  challenge = u.searchParams.get("code_challenge")!;
  return { u, data: r.data };
}
const back = (u: URL, extra: Record<string, string> = {}) =>
  new URLSearchParams({ state: u.searchParams.get("state")!, code: "the-code", ...extra });

describe("microsoft sign-in", () => {
  test("a plugin with no app registration says how to make one", async () => {
    const none = () => mkCtx("u1", { clientId: "" }).ctx;
    await expect(plugin.connect!(none(), { scopes: ["Mail.Read"] })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    const st = await plugin.status!(none());
    expect(st.state).toBe("error");
    // A web client needs its secret and a redirect base too.
    const web = mkCtx("u1", { clientType: "web" }).ctx;
    await expect(plugin.connect!(web, { scopes: ["Mail.Read"] })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
  });

  test("the authorize address carries PKCE S256, state, the tenant and the delegated scopes; the pending sign-in is hashed", async () => {
    const c = mkCtx();
    const { u, data } = await start(c, { scopes: ["Mail.Read"] });
    expect(u.origin + u.pathname).toBe(`${base}/common/oauth2/v2.0/authorize`);
    expect(u.searchParams.get("client_id")).toBe(CID);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("state")!.length).toBeGreaterThan(30);
    expect(u.searchParams.get("scope")!.split(" ")).toEqual([
      "offline_access",
      "https://graph.microsoft.com/User.Read",
      "https://graph.microsoft.com/Mail.Read",
    ]);
    expect(u.searchParams.get("scope")).not.toContain("ReadWrite");
    expect(u.searchParams.get("prompt")).toBe("select_account");
    // A public client: the redirect is http://localhost, and the person pastes the address back.
    expect(u.searchParams.get("redirect_uri")).toMatch(/^http:\/\/localhost:\d+$/);
    expect(data).toEqual({ completion: "paste" });
    const pending = JSON.parse(c.get().pending!);
    expect(pending.s).not.toBe(u.searchParams.get("state"));
    expect(pending.v).not.toBe(u.searchParams.get("code_challenge"));
    expect(JSON.stringify(c.get())).not.toContain(u.searchParams.get("state")!);
  });

  test("a work tenant goes in the path; a bad tenant falls back to common", async () => {
    const a = await start(mkCtx("u1", { tenant: "11111111-2222-3333-4444-555555555555" }), {
      scopes: ["Mail.Read"],
    });
    expect(a.u.pathname).toBe("/11111111-2222-3333-4444-555555555555/oauth2/v2.0/authorize");
    const b = await start(mkCtx("u1", { tenant: "../evil" }), { scopes: ["Mail.Read"] });
    expect(b.u.pathname).toBe("/common/oauth2/v2.0/authorize");
  });

  test("a web client sends its secret and uses the public redirect address", async () => {
    const c = mkCtx("u1", { clientType: "web", clientSecret: "shh-test" });
    const { u, data } = await start(c, { scopes: ["Mail.Read", "Mail.Send"] });
    expect(u.searchParams.get("redirect_uri")).toBe(redirectUri());
    expect(redirectUri()).toBe("https://zetta.test/api/plugins/microsoft/callback");
    expect(data).toBeUndefined();
    await plugin.callback!(c.ctx, back(u));
    const code = tokenForms[0]!.form;
    expect(code.get("client_secret")).toBe("shh-test");
    expect(code.get("redirect_uri")).toBe(redirectUri());
  });

  test("a public client never sends a secret, even one left over in the config", async () => {
    const c = mkCtx("u1", { clientSecret: "leftover-test" });
    const { u } = await start(c, { scopes: ["Mail.Read"] });
    await plugin.callback!(c.ctx, back(u));
    expect(tokenForms[0]!.form.get("client_secret")).toBeNull();
    expect(tokenForms[0]!.form.get("redirect_uri")).toBe(u.searchParams.get("redirect_uri"));
    expect(tokenForms[0]!.path).toBe("/common/oauth2/v2.0/token");
  });

  test("the code is exchanged with the PKCE verifier; the account is the address Graph names, with the permissions that were granted", async () => {
    const c = mkCtx();
    const { u } = await start(c, { scopes: ["Mail.Read", "Mail.Send"] });
    await plugin.callback!(c.ctx, back(u));
    const [acc] = accountsOf(c);
    expect(acc).toMatchObject({
      email: "me@example.invalid",
      refreshToken: "ref-1",
      accessToken: "acc-1",
      scopes: "Mail.Read Mail.Send",
    });
    expect(c.get().pending).toBeUndefined();
    expect(await plugin.status!(c.ctx)).toMatchObject({
      state: "connected",
      info: { accounts: [{ email: "me@example.invalid", state: "connected" }] },
    });
    expect(JSON.stringify(await plugin.status!(c.ctx))).not.toMatch(/acc-1|ref-1/);
  });

  test("permissions come back as bare names or as full addresses; only the ones that were granted are kept", async () => {
    scopeReply =
      "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read openid";
    const c = mkCtx();
    const { u } = await start(c, { scopes: ["Mail.Read", "Mail.Send"] });
    await plugin.callback!(c.ctx, back(u));
    expect(accountsOf(c)[0]!.scopes).toBe("Mail.Read");
  });

  test("a personal account with no `mail` is named by its user principal name", async () => {
    profile = { mail: null, userPrincipalName: "Pat@Outlook.example.invalid" };
    const c = mkCtx();
    const { u } = await start(c, { scopes: ["Mail.Read"] });
    await plugin.callback!(c.ctx, back(u));
    expect(accountsOf(c)[0]!.email).toBe("pat@outlook.example.invalid");
  });

  test("a wrong state is refused without cancelling the real sign-in; a state is used once", async () => {
    const c = mkCtx();
    const { u } = await start(c, { scopes: ["Mail.Read"] });
    await expect(
      plugin.callback!(c.ctx, new URLSearchParams({ state: "forged", code: "x" })),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(c.get().pending).toBeTruthy();
    await plugin.callback!(c.ctx, back(u));
    await expect(plugin.callback!(c.ctx, back(u))).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("an old sign-in, a refusal and a failed exchange are named, and no account is made", async () => {
    let c = mkCtx();
    let s = await start(c, { scopes: ["Mail.Read"] });
    now += 11 * 60_000;
    await expect(plugin.callback!(c.ctx, back(s.u))).rejects.toMatchObject({
      code: "STATE_EXPIRED",
    });
    c = mkCtx();
    s = await start(c, { scopes: ["Mail.Read"] });
    await expect(
      plugin.callback!(c.ctx, back(s.u, { error: "access_denied" })),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    c = mkCtx();
    s = await start(c, { scopes: ["Mail.Read"] });
    challenge = "something else"; // the verifier no longer fits
    await expect(plugin.callback!(c.ctx, back(s.u))).rejects.toMatchObject({
      code: "EXCHANGE_FAILED",
    });
    expect(accountsOf(c)).toEqual([]);
  });

  test("the address the browser ended on, pasted back, finishes the sign-in", async () => {
    const c = mkCtx();
    const { u } = await start(c, { scopes: ["Mail.Read"] });
    const redirect = u.searchParams.get("redirect_uri")!;
    const pasted = `${redirect}/?code=the-code&state=${encodeURIComponent(u.searchParams.get("state")!)}&session_state=x`;
    await plugin.callback!(c.ctx, pastedParams(pasted));
    expect(accountsOf(c)).toHaveLength(1);
  });

  test("several accounts share the one app registration; a permission change updates the account it names", async () => {
    const c = mkCtx();
    let s = await start(c, { scopes: ["Mail.Read"] });
    await plugin.callback!(c.ctx, back(s.u));
    profile = { mail: "two@example.invalid" };
    s = await start(c, { scopes: ["Mail.Read", "Mail.Send"] });
    await plugin.callback!(c.ctx, back(s.u));
    expect(accountsOf(c).map((a) => a.email)).toEqual([
      "me@example.invalid",
      "two@example.invalid",
    ]);
    const again = await start(c, {
      scopes: ["Mail.Read", "Mail.Send"],
      account: "ME@example.invalid",
    });
    expect(again.u.searchParams.get("login_hint")).toBe("me@example.invalid");
    await expect(
      plugin.connect!(c.ctx, { scopes: ["Mail.Read"], account: "nobody@example.invalid" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ACCOUNT" });
  });

  test("only Mail.Read and Mail.Send can be asked for", async () => {
    const c = mkCtx();
    for (const scopes of [["Mail.ReadWrite"], ["Mail.Read", "Files.Read"], [], [1]])
      await expect(plugin.connect!(c.ctx, { scopes })).rejects.toMatchObject({
        code: "INVALID_SCOPE",
      });
  });
});

describe("keeping the sign-in alive", () => {
  async function connected() {
    scopeReply = "Mail.Read User.Read";
    const c = mkCtx();
    const { u } = await start(c, { scopes: ["Mail.Read"] });
    await plugin.callback!(c.ctx, back(u));
    return c;
  }
  const refresh = async (c: ReturnType<typeof mkCtx>) => {
    const { accessToken, accountCtx } = await import("./oauth");
    return accessToken(accountCtx(c.ctx, "me@example.invalid"));
  };

  test("a token that is still good is used as it is; an old one is refreshed and the new refresh token replaces the old", async () => {
    const c = await connected();
    expect(await refresh(c)).toBe("acc-1");
    expect(tokenForms.filter((t) => t.form.get("grant_type") === "refresh_token")).toHaveLength(0);
    now += 2 * 3600_000;
    expect(await refresh(c)).toBe("acc-r1");
    const form = tokenForms.at(-1)!.form;
    expect(form.get("refresh_token")).toBe("ref-1");
    expect(form.get("client_secret")).toBeNull();
    expect(accountsOf(c)[0]).toMatchObject({ refreshToken: "ref-r1", accessToken: "acc-r1" });
    expect(accountsOf(c)[0]!.scopes).toBe("Mail.Read");
  });

  test("an expired or revoked refresh token, and a policy that wants a new sign-in, send the person back to sign in", async () => {
    for (const mode of ["invalid_grant", "interaction_required"] as const) {
      const c = await connected();
      now += 2 * 3600_000;
      tokenMode = mode;
      await expect(refresh(c)).rejects.toMatchObject({ code: "NEEDS_AUTH" });
      expect(accountsOf(c)[0]!.refreshToken).toBeUndefined();
      expect(accountsOf(c)[0]!.email).toBe("me@example.invalid");
      const st = await plugin.status!(c.ctx);
      expect(st.state).toBe("needs-auth");
      expect(JSON.stringify(st)).not.toContain(mode);
    }
  });

  test("a Microsoft outage is not a revoked sign-in: the tokens stay", async () => {
    const c = await connected();
    now += 2 * 3600_000;
    tokenMode = "down";
    await expect(refresh(c)).rejects.toMatchObject({ code: "MICROSOFT_UNAVAILABLE" });
    expect(accountsOf(c)[0]!.refreshToken).toBe("ref-1");
  });

  test("one refresh serves callers that arrive together", async () => {
    const c = await connected();
    now += 2 * 3600_000;
    const tokens = await Promise.all([refresh(c), refresh(c), refresh(c)]);
    expect(new Set(tokens).size).toBe(1);
    expect(tokenForms.filter((t) => t.form.get("grant_type") === "refresh_token")).toHaveLength(1);
  });
});

describe("removing an account", () => {
  test("one account goes, the other and the app registration stay; no revoke call exists, so none is made", async () => {
    const c = mkCtx("u1", { clientSecret: "keep-test", tenant: "contoso.example.invalid" });
    let s = await start(c, { scopes: ["Mail.Read"] });
    await plugin.callback!(c.ctx, back(s.u));
    profile = { mail: "two@example.invalid" };
    s = await start(c, { scopes: ["Mail.Read"] });
    await plugin.callback!(c.ctx, back(s.u));
    const before = tokenForms.length;
    await plugin.disconnect!(c.ctx, { account: "me@example.invalid" });
    expect(accountsOf(c).map((a) => a.email)).toEqual(["two@example.invalid"]);
    await expect(
      plugin.disconnect!(c.ctx, { account: "me@example.invalid" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ACCOUNT" });
    await plugin.disconnect!(c.ctx);
    expect(c.get()).toEqual({
      clientId: CID,
      clientType: "desktop",
      clientSecret: "keep-test",
      tenant: "contoso.example.invalid",
    });
    expect(tokenForms.length).toBe(before); // nothing was sent to Microsoft
  });

  test("the tool lists the accounts and what each can do, and no token", async () => {
    scopeReply = "Mail.Read User.Read";
    const c = mkCtx();
    const { u } = await start(c, { scopes: ["Mail.Read"] });
    await plugin.callback!(c.ctx, back(u));
    const out = (await plugin
      .tools!.find((t) => t.name === "microsoft_accounts")!
      .handler(c.ctx, {})) as {
      accounts: Record<string, unknown>[];
    };
    expect(out.accounts).toEqual([
      { email: "me@example.invalid", state: "connected", permissions: ["Mail.Read"] },
    ]);
  });

  test("the guide names the app registration steps, the redirect address and the admin consent", () => {
    process.env.ZETTA_OAUTH_REDIRECT_BASE = "https://zetta.test";
    const steps = (plugin.guide?.() ?? []).join("\n");
    expect(steps).toContain("/api/plugins/microsoft/callback");
    expect(steps).toContain("Mail.Read");
    expect(steps).toContain("admin consent");
    expect(steps).toContain("Do not add Mail.ReadWrite");
  });
});

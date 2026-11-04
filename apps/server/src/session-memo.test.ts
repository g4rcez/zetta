import { describe, expect, test } from "bun:test";

import { createApp } from "./app";
import { createIdentityAccess } from "./modules/identity/access";
import { memoizeSession } from "./session-memo";

const user = {
  user: { id: "u1", name: "Fixture", email: "fixture@example.invalid" },
  session: { id: "s" },
};
const counting = () => {
  const calls: unknown[] = [];
  const auth = {
    api: {
      getSession: async (input: { headers: Headers; query?: unknown }) => {
        calls.push(input);
        return input.headers.get("cookie") ? user : null;
      },
      other: () => "other",
    },
    handler: () => new Response("auth"),
  };
  return { calls, auth };
};

describe("memoizeSession", () => {
  test("asks once for the same Headers object and again for a new one", async () => {
    const { calls, auth } = counting();
    const memo = memoizeSession(auth);
    const headers = new Headers({ cookie: "a" });
    expect(await memo.api.getSession({ headers })).toBe(user);
    expect(await memo.api.getSession({ headers })).toBe(user);
    expect(calls).toHaveLength(1);
    await memo.api.getSession({ headers: new Headers({ cookie: "a" }) });
    expect(calls).toHaveLength(2);
  });

  test("an option other than headers is never answered from memory, and other members pass through", async () => {
    const { calls, auth } = counting();
    const memo = memoizeSession(auth);
    const headers = new Headers({ cookie: "a" });
    await memo.api.getSession({ headers });
    await memo.api.getSession({ headers, query: { disableCookieCache: true } });
    expect(calls).toHaveLength(2);
    expect(memo.api.other()).toBe("other");
    expect(memo.handler).toBe(auth.handler);
  });

  test("a failed lookup is not remembered", async () => {
    let n = 0;
    const memo = memoizeSession({
      api: {
        getSession: async (input: { headers: Headers }) => {
          if (n++ === 0) throw new Error("db down");
          return input.headers ? user : null;
        },
      },
    });
    const headers = new Headers();
    await expect(memo.api.getSession({ headers })).rejects.toThrow("db down");
    expect(await memo.api.getSession({ headers })).toBe(user);
  });

  test("the request log and the route check share one lookup per request", async () => {
    const { calls, auth } = counting();
    const memo = memoizeSession(auth);
    const access = createIdentityAccess(memo, async () => ({ isAdmin: false }));
    const app = createApp({
      auth: memo,
      installation: {
        access,
        installation: {
          load: async () => ({
            networkMode: "local",
            publicUrl: null,
            onboarding: "done",
            laya: "off",
            layaLanguages: ["en"],
          }),
        } as never,
        runningMode: "local",
      },
      webOrigin: "https://app.example.invalid",
      desktopOrigins: [],
    });
    const res = await app.handle(
      new Request("http://localhost/api/installation", { headers: { cookie: "a" } }),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});

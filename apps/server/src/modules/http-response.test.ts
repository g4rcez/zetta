import { describe, expect, test } from "bun:test";
import { accessFail, createGuardedRoute, fail, out, rejectUntrustedOrigin } from "./http-response";

const trusted = ["https://app.example.invalid"];
const request = (method: string, origin?: string) =>
  new Request("https://app.example.invalid/api/x", {
    method,
    headers: origin ? { origin } : {},
  });

describe("out and fail", () => {
  test("out sends JSON with no-store and the given status", async () => {
    const res = out({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  test("fail wraps code and message and keeps extra keys", async () => {
    const res = fail(409, "STALE", "Reload.", { fix: "Reload the page." });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "STALE", message: "Reload.", fix: "Reload the page." },
    });
  });
});

describe("accessFail", () => {
  test.each([
    ["SIGN_IN_REQUIRED", 401],
    ["NOT_FOUND", 404],
    ["IDENTITY_UNAVAILABLE", 503],
    ["ACCESS_DENIED", 403],
  ])("%s answers %d", async (code, status) => {
    const res = accessFail({ code, message: "m" });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: { code, message: "m" } });
  });
});

describe("rejectUntrustedOrigin", () => {
  test("a GET needs no origin", () => {
    expect(rejectUntrustedOrigin(request("GET"), trusted)).toBeUndefined();
  });

  test("a write from a trusted origin passes", () => {
    expect(
      rejectUntrustedOrigin(request("POST", "https://app.example.invalid"), trusted),
    ).toBeUndefined();
  });

  test.each([["POST"], ["PATCH"], ["DELETE"]])(
    "a %s without an origin is refused",
    async (method) => {
      const res = rejectUntrustedOrigin(request(method), trusted);
      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({
        error: {
          code: "UNTRUSTED_ORIGIN",
          message: "Open Zetta from its trusted application and try again.",
        },
      });
    },
  );

  test("a write from another origin is refused", () => {
    expect(
      rejectUntrustedOrigin(request("POST", "https://evil.example.invalid"), trusted)?.status,
    ).toBe(403);
  });
});

describe("createGuardedRoute", () => {
  const calls: string[] = [];
  const access = {
    requireActive: async (headers: Headers) => {
      calls.push("requireActive");
      if (!headers.get("cookie")) throw new Error("no session");
      return { userId: "user-1" };
    },
  };
  const guard = createGuardedRoute({
    access,
    trustedOrigins: trusted,
    mapError: () => fail(500, "UNAVAILABLE", "Something went wrong. Please retry."),
  });
  const ctx = (req: Request) => ({ request: req, body: { a: 1 }, params: { id: "7" }, query: {} });

  test("hands the actor, body, params and query to the work and wraps the result", async () => {
    calls.length = 0;
    const handler = guard(
      async (c) => ({ who: c.actor.userId, body: c.body, id: c.params.id }),
      201,
    );
    const req = new Request("https://app.example.invalid/api/x", {
      method: "POST",
      headers: { origin: "https://app.example.invalid", cookie: "s" },
    });
    const res = await handler(ctx(req));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ who: "user-1", body: { a: 1 }, id: "7" });
  });

  test("an untrusted write is refused before any session lookup or work", async () => {
    calls.length = 0;
    const handler = guard(async () => {
      calls.push("work");
      return {};
    });
    const res = await handler(ctx(request("POST", "https://evil.example.invalid")));
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("a GET skips the origin check", async () => {
    const handler = guard(async () => ({ ok: true }));
    const req = new Request("https://app.example.invalid/api/x", { headers: { cookie: "s" } });
    expect((await handler(ctx(req))).status).toBe(200);
  });

  test("anything thrown goes to mapError", async () => {
    const handler = guard(async () => ({}));
    const res = await handler(ctx(request("GET")));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "UNAVAILABLE", message: "Something went wrong. Please retry." },
    });
  });
});

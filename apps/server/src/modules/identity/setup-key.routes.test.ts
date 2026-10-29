import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { createIdentityAccess } from "./access";
import { matchesConnectionKey } from "./setup-key";

const origin = "https://app.example.invalid";
const key = "k".repeat(43) + "=";

function app(open: boolean) {
  const auth = { api: { getSession: async () => null }, handler: () => new Response("auth") };
  const identity = {
    access: createIdentityAccess(auth, async () => null),
    enrollment: {} as never,
    setupOpen: async () => open,
    verifySetupKey: (candidate: string) => matchesConnectionKey(candidate, key),
  };
  return createApp({ auth, identity, webOrigin: origin, desktopOrigins: [] });
}
const post = (a: ReturnType<typeof app>, body: unknown, headers: Record<string, string> = {}) =>
  a.handle(
    new Request("http://localhost/api/identity/setup/key", {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/identity/setup/key", () => {
  test("accepts the server connection key while setup is open", async () => {
    const response = await post(app(true), { key });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  test("rejects a wrong key", async () => {
    const response = await post(app(true), { key: "wrong" });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "SETUP_KEY_MISMATCH",
    );
  });
  test("is closed once the installation has an admin", async () => {
    const response = await post(app(false), { key });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "SETUP_CLOSED",
    );
  });
  test("rejects an untrusted origin and extra fields", async () => {
    expect(
      (await post(app(true), { key }, { origin: "https://evil.example.invalid" })).status,
    ).toBe(403);
    expect((await post(app(true), { key, extra: 1 })).status).toBe(400);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createInboundRoutes, type InboundServices } from "./routes";

/**
 * The signature check belongs to the plugin (whatsapp-push.test.ts) and the wake to the service (inbound.integration.test.ts). This file
 * checks what the public route itself decides: which requests reach the service, and how a verdict becomes an HTTP answer.
 * The service here answers with the verdict written in the body.
 */
let calls: string[] = [];
const app = new Elysia().use(
  createInboundRoutes(
    {
      access: {} as never,
      inbound: {
        push: async (user: string, plugin: string, headers: Headers, raw: string) => {
          calls.push(`${user}:${plugin}:${headers.get("x-webhook-hmac")}:${raw.length}`);
          return raw;
        },
      } as never,
    } satisfies InboundServices,
    ["http://web.test"],
  ),
);
const hook = (path: string, raw: string, headers: Record<string, string> = {}) =>
  app.handle(
    new Request(`http://localhost/api/inbound/${path}`, { method: "POST", body: raw, headers }),
  );
beforeEach(() => {
  calls = [];
});

describe("push hook route", () => {
  test("needs no session or origin, and hands the service the raw body and the signature header", async () => {
    const r = await hook("whatsapp/hook/user-a", "wake", { "x-webhook-hmac": "abc" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(calls).toEqual(["user-a:whatsapp:abc:4"]);
  });

  test("a genuine call that is not news is answered 200, so the channel does not retry", async () => {
    expect((await hook("whatsapp/hook/user-a", "ignore")).status).toBe(200);
  });

  test("an invalid call gets 401 with the same body as any other refusal", async () => {
    const bad = await hook("whatsapp/hook/user-a", "invalid");
    const oddUser = await hook("whatsapp/hook/user%2Fa", "wake");
    const oddPlugin = await hook("Nope!/hook/user-a", "wake");
    expect([bad.status, oddUser.status, oddPlugin.status]).toEqual([401, 401, 401]);
    const refusal = { error: { code: "UNAUTHORIZED", message: "Not allowed." } };
    expect(await bad.json()).toEqual(refusal);
    expect(await oddUser.json()).toEqual(refusal);
    expect(await oddPlugin.json()).toEqual(refusal);
    expect(calls).toEqual(["user-a:whatsapp:null:7"]); // an odd user or plugin id never reaches the service
  });

  test("a body over the limit is refused before the service sees it", async () => {
    const big = "x".repeat(1_000_001);
    const r = await hook("whatsapp/hook/user-a", big, { "content-length": String(big.length) });
    expect(r.status).toBe(413);
    expect(calls).toEqual([]);
  });
});

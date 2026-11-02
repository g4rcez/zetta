import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { PluginContext } from "./registry";
import { configureWhatsapp, WHATSAPP } from "./whatsapp";

type Hook = Record<string, unknown>;
let status = "WORKING";
let webhooks: Record<string, Hook[]> = {}; // by session name
let puts: { name?: string; config?: { webhooks?: Hook[] } }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const named = /^\/api\/sessions\/([^/]+)$/.exec(u.pathname);
    if (named) {
      const name = decodeURIComponent(named[1]!);
      if (req.method === "PUT") {
        const body = (await req.json()) as (typeof puts)[number];
        puts.push(body);
        webhooks[name] = body.config?.webhooks ?? [];
        return Response.json({ status });
      }
      return Response.json({ status, config: { webhooks: webhooks[name] ?? [] } });
    }
    if (u.pathname.endsWith("/chats/overview")) return Response.json([]);
    return new Response("nf", { status: 404 });
  },
});
afterAll(() => server.stop(true));

/** A user's plugin context: the config is saved by `setConfig`, like the platform does (sealed per user). */
const userCtx = (userId: string, extra: Record<string, string> = {}) => {
  // The session is named after the user so each user has their own WAHA session, as on a server the user brought.
  let config: Record<string, string> = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    session: userId,
    ...extra,
  };
  return {
    userId,
    get config() {
      return config;
    },
    async setConfig(next: Record<string, string>) {
      config = next;
    },
  } as PluginContext;
};
const HOOK = "http://host.docker.internal:3000";
const withHook = (userId: string) => userCtx(userId, { hookUrl: HOOK });
const ours = (userId: string) => `${HOOK}/api/inbound/whatsapp/hook/${userId}`;
const filter = { direct: true, groups: false, chats: [] as string[] };
const inbound = WHATSAPP.inbound!;
const poll = (c: PluginContext, cursor: unknown) =>
  inbound.poll(c, cursor, { filter, maxEvents: 50 });
const body = (event: string, fromMe = false) => JSON.stringify({ event, payload: { fromMe } });
const sign = (key: string, raw: string) => createHmac("sha512", key).update(raw).digest("hex");
const signed = (key: string, raw: string) => new Headers({ "x-webhook-hmac": sign(key, raw) });
const keyOf = (c: PluginContext) => c.config.hookKey ?? "";

beforeEach(() => {
  status = "WORKING";
  webhooks = {};
  puts = [];
  configureWhatsapp({ allowPrivate: true });
});

describe("whatsapp push (webhook as a doorbell), saved per user in the plugin", () => {
  test("turning it on saves a random key in the user's own settings and registers the webhook once", async () => {
    const a = withHook("user-a"),
      b = withHook("user-b");
    await inbound.enable!(a);
    await inbound.enable!(b);
    expect(keyOf(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(keyOf(a)).not.toBe(keyOf(b));
    expect(a.config.hookUrl).toBe(HOOK); // the other settings are kept
    expect(webhooks["user-a"]!.map((w) => w.url)).toEqual([ours("user-a")]);
    expect(webhooks["user-b"]!.map((w) => w.url)).toEqual([ours("user-b")]);
    expect(puts).toHaveLength(2);
    const key = keyOf(a);
    await inbound.enable!(a); // again: same key, WAHA already has it, no restart
    expect(keyOf(a)).toBe(key);
    expect(puts).toHaveLength(2);
    expect(webhooks["user-a"]![0]).toEqual({
      url: ours("user-a"),
      events: ["message"],
      hmac: { key: keyOf(a) },
      retries: { policy: "exponential", delaySeconds: 2, attempts: 5 },
    });
  });

  test("a webhook of something else on the session is kept", async () => {
    webhooks["user-a"] = [
      { url: "https://example.invalid/other", events: ["session.status"], hmac: null },
    ];
    await inbound.enable!(withHook("user-a"));
    const saved = webhooks["user-a"]!;
    expect(saved.map((w) => w.url)).toEqual(["https://example.invalid/other", ours("user-a")]);
    expect(saved[0]).toEqual({ url: "https://example.invalid/other", events: ["session.status"] });
  });

  test("with it set up, polling is slow; the poll that finds it missing registers it", async () => {
    const c = withHook("user-a");
    status = "SCAN_QR_CODE"; // not paired yet: nothing is registered and the session is not restarted
    await inbound.enable!(c);
    expect(puts).toEqual([]);
    const first = await poll(c, null);
    expect(first.nextPollSeconds).toBeUndefined();
    status = "WORKING";
    const next = await poll(c, first.cursor);
    expect(puts).toHaveLength(1);
    expect(next.nextPollSeconds).toBe(900);
    expect((await poll(c, next.cursor)).nextPollSeconds).toBe(900);
    expect(puts).toHaveLength(1);
  });

  test("without the user's address nothing is saved or registered and polling keeps its speed", async () => {
    const c = userCtx("user-a");
    await inbound.enable!(c);
    expect(c.config.hookKey).toBeUndefined();
    expect((await poll(c, null)).nextPollSeconds).toBeUndefined();
    expect(puts).toEqual([]);
  });

  test("a poll never creates the key: that needs the context that can save settings", async () => {
    const c = withHook("user-a"); // address typed, push never turned on
    expect((await poll(c, null)).nextPollSeconds).toBeUndefined();
    expect(c.config.hookKey).toBeUndefined();
    expect(puts).toEqual([]);
  });

  test("a call signed with this user's key is news; every other call is refused", async () => {
    const a = withHook("user-a"),
      b = withHook("user-b");
    await inbound.enable!(a);
    await inbound.enable!(b);
    const raw = body("message");
    const verify = inbound.verifyPush!;
    expect(verify(a, signed(keyOf(a), raw), raw)).toBe("wake");
    expect(verify(a, signed(keyOf(b), raw), raw)).toBe("invalid"); // another user's key
    expect(verify(a, signed("wrong", raw), raw)).toBe("invalid");
    expect(verify(a, new Headers(), raw)).toBe("invalid");
    expect(verify(a, signed(keyOf(a), raw), raw + " ")).toBe("invalid"); // body changed after signing
    expect(verify(userCtx("user-c"), signed("", raw), raw)).toBe("invalid"); // push never set up: no key to match
  });

  test("genuine calls that are not new messages from other people are ignored, not refused", async () => {
    const a = withHook("user-a");
    await inbound.enable!(a);
    const verify = inbound.verifyPush!;
    const mine = body("message", true),
      other = body("session.status");
    expect(verify(a, signed(keyOf(a), mine), mine)).toBe("ignore");
    expect(verify(a, signed(keyOf(a), other), other)).toBe("ignore");
    expect(verify(a, signed(keyOf(a), "not json"), "not json")).toBe("ignore");
  });
});

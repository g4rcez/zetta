import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { PluginContext } from "./registry";
import { configureTelegram, TELEGRAM } from "./telegram";

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0";
let updates: unknown[] = [], webhook = false; const bodies: Record<string, unknown>[] = [];
const msg = (update_id: number, chat: Record<string, unknown>, text: string, from: Record<string, unknown> = { id: 42, first_name: "Bob" }) => ({ update_id, message: { message_id: update_id * 10, date: 1000 + update_id, chat, from, text } });
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>; bodies.push(body);
    if (webhook) return Response.json({ ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active" }, { status: 409 });
    return Response.json({ ok: true, result: updates });
  },
});
afterAll(() => server.stop(true));
// The poller's context refuses to re-seal the config; a poll must never try.
const ctx: PluginContext = { userId: "u1", config: { token: TOKEN }, setConfig: () => { throw new Error("poll must not call setConfig"); } };
const filter = { direct: true, groups: false, chats: [] as string[] };
const poll = (cursor: unknown, f = filter, maxEvents = 50) => TELEGRAM.inbound!.poll(ctx, cursor, { filter: f, maxEvents });
const priv = { id: 42, type: "private", first_name: "Bob" }, group = { id: -1001, type: "supergroup", title: "Dev team" };
beforeEach(() => { updates = []; webhook = false; bodies.length = 0; configureTelegram({ apiBase: `http://127.0.0.1:${server.port}` }); });

describe("telegram inbound", () => {
  test("the first poll only remembers where now is; later polls deliver new people messages once", async () => {
    updates = [msg(1, priv, "old")];
    const first = await poll(null);
    expect(first.events).toEqual([]); expect(first.cursor).toEqual({ v: 1, last: 1 });
    updates = [msg(1, priv, "old"), msg(2, priv, "my app crashes"), msg(3, group, "group chat"), msg(4, priv, "from a bot", { id: 9, is_bot: true }), { update_id: 5, channel_post: { message_id: 1, date: 1, chat: { id: -5, type: "channel" }, text: "x" } }];
    const next = await poll(first.cursor);
    expect(next.events.map((e) => e.text)).toEqual(["my app crashes"]);
    expect(next.events[0]).toMatchObject({ key: "42:20", chat: "42", chatName: "Bob", from: "Bob", group: false });
    expect(next.cursor).toEqual({ v: 1, last: 5 });
    expect((await poll(next.cursor)).events).toEqual([]);
    // same subscription as the read tools (Telegram stores it per bot), never confirmed
    expect(bodies.every((b) => b.offset === -100 && JSON.stringify(b.allowed_updates) === JSON.stringify(["message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member"]))).toBe(true);
  });
  test("groups only when enabled; an allowlist of chats wins", async () => {
    updates = [msg(2, priv, "dm"), msg(3, group, "in group")];
    expect((await poll({ v: 1, last: 1 }, { direct: true, groups: true, chats: [] })).events.map((e) => e.text)).toEqual(["dm", "in group"]);
    expect((await poll({ v: 1, last: 1 }, { direct: true, groups: false, chats: ["-1001"] })).events.map((e) => e.text)).toEqual(["in group"]);
  });
  test("a full window that skipped updates is reported; maxEvents keeps the rest for the next poll", async () => {
    updates = Array.from({ length: 100 }, (_, i) => msg(i + 50, priv, `m${i}`));
    const r = await poll({ v: 1, last: 10 }, filter, 3);
    expect(r.warning).toContain("missed");
    expect(r.events.map((e) => e.text)).toEqual(["m0", "m1", "m2"]);
    expect(r.cursor).toEqual({ v: 1, last: 52 });
  });
  test("a webhook blocks reading with a clear error; the reply tool and chat normalization are declared", async () => {
    webhook = true;
    await expect(poll({ v: 1, last: 1 })).rejects.toMatchObject({ code: "WEBHOOK_ACTIVE" });
    expect(TELEGRAM.inbound!.reply).toMatchObject({ tool: "send_message", chatArg: "chat" });
    expect(TELEGRAM.inbound!.reply.normalize(" 42 ")).toBe("42");
    expect(TELEGRAM.tools!.find((t) => t.name === "read_messages")!.effect).toBe("read");
    expect(TELEGRAM.tools!.find((t) => t.name === "send_message")!.effect).toBeUndefined();
  });
});

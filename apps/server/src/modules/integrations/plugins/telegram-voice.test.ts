import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { PluginContext } from "./registry";
import { configureTelegram, TELEGRAM } from "./telegram";

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0";
let updates: unknown[] = [];
let filePath = "voice/file_1.oga";
let fileBytes = new Uint8Array([79, 103, 103, 83, 1, 2, 3]);
let fileSize = 7;
const calls: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname}`);
    if (url.pathname.startsWith(`/file/bot${TOKEN}/`))
      return new Response(fileBytes, { headers: { "content-type": "audio/ogg" } });
    const method = url.pathname.split("/").at(-1);
    if (method === "getFile")
      return Response.json({
        ok: true,
        result: { file_id: "F", file_path: filePath, file_size: fileSize },
      });
    return Response.json({ ok: true, result: updates });
  },
});
afterAll(() => server.stop(true));
const ctx: PluginContext = {
  userId: "u1",
  config: { token: TOKEN },
  setConfig: () => {
    throw new Error("poll must not call setConfig");
  },
};
const filter = { direct: true, groups: false, chats: [] as string[] };
const poll = (cursor: unknown) => TELEGRAM.inbound!.poll(ctx, cursor, { filter, maxEvents: 50 });
const priv = { id: 42, type: "private", first_name: "Bob" };
const withVoice = (
  id: number,
  voice: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  update_id: id,
  message: {
    message_id: id * 10,
    date: 1000 + id,
    chat: priv,
    from: { id: 42, first_name: "Bob" },
    voice,
    ...extra,
  },
});
beforeEach(() => {
  updates = [];
  calls.length = 0;
  filePath = "voice/file_1.oga";
  fileBytes = new Uint8Array([79, 103, 103, 83, 1, 2, 3]);
  fileSize = 7;
  configureTelegram({ apiBase: `http://127.0.0.1:${server.port}` });
});

describe("telegram voice notes", () => {
  test("a voice note arrives as an event with a reference to fetch, and its text says what it is", async () => {
    updates = [withVoice(1, { file_id: "AwACAg-1", duration: 12, file_size: 40_000 })];
    const first = await poll(null);
    expect(first.events).toEqual([]);
    updates = [withVoice(2, { file_id: "AwACAg-2", duration: 12, file_size: 40_000 })];
    const next = await poll(first.cursor);
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toMatchObject({
      text: "(voice note)",
      media: true,
      audio: { ref: "AwACAg-2", seconds: 12 },
    });
  });

  test("a caption stays the text, and a voice note that is too long or too big has no audio to fetch", async () => {
    const first = await poll(null);
    updates = [
      withVoice(3, { file_id: "a", duration: 5, file_size: 100 }, { caption: "listen to this" }),
      withVoice(4, { file_id: "b", duration: 301, file_size: 100 }),
      withVoice(5, { file_id: "c", duration: 5, file_size: 11 * 1024 * 1024 }),
    ];
    const r = await poll(first.cursor);
    expect(r.events.map((e) => [e.text, e.audio?.ref])).toEqual([
      ["listen to this", "a"],
      ["(voice note)", undefined],
      ["(voice note)", undefined],
    ]);
  });

  test("fetching it asks Telegram where the file is, then downloads it from the file host with the token", async () => {
    const got = await TELEGRAM.inbound!.fetchAudio!(ctx, "AwACAg-2");
    expect(Array.from(got.bytes)).toEqual([79, 103, 103, 83, 1, 2, 3]);
    expect(got.mimeType).toBe("audio/ogg");
    expect(calls).toEqual([`POST /bot${TOKEN}/getFile`, `GET /file/bot${TOKEN}/voice/file_1.oga`]);
  });

  test("a path Telegram sends that leaves its folder, or a file that is too big, is refused", async () => {
    filePath = "../../etc/passwd";
    await expect(TELEGRAM.inbound!.fetchAudio!(ctx, "x")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    filePath = "voice/a b.oga";
    await expect(TELEGRAM.inbound!.fetchAudio!(ctx, "x")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    filePath = "voice/ok.oga";
    fileSize = 11 * 1024 * 1024;
    await expect(TELEGRAM.inbound!.fetchAudio!(ctx, "x")).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
  });
});

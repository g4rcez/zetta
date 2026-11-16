import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { PluginContext } from "./registry";
import { configureWhatsapp, WHATSAPP } from "./whatsapp";

const CHAT = "551199@c.us";
type Msg = Record<string, unknown>;
let messages: Msg[] = [];
let mediaUrl: string | undefined;
let fileBytes = new Uint8Array([1, 2, 3, 4]);
const seen: string[] = [];
const keys: (string | null)[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    seen.push(`${req.method} ${u.pathname}${u.search}`);
    keys.push(req.headers.get("x-api-key"));
    if (u.pathname === "/api/default/chats/overview")
      return Response.json([
        { id: CHAT, name: "Maria", lastMessage: { timestamp: Math.floor(Date.now() / 1000) + 30 } },
      ]);
    if (u.pathname === `/api/default/chats/${encodeURIComponent(CHAT)}/messages`)
      return Response.json([...messages].reverse());
    if (u.pathname.startsWith(`/api/default/chats/${encodeURIComponent(CHAT)}/messages/`))
      return Response.json({
        id: "x",
        media: mediaUrl ? { url: mediaUrl, mimetype: "audio/ogg; codecs=opus" } : {},
      });
    if (u.pathname.startsWith("/api/files/"))
      return new Response(fileBytes, { headers: { "content-type": "audio/ogg" } });
    return new Response("nf", { status: 404 });
  },
});
afterAll(() => server.stop(true));
const ctx: PluginContext = {
  userId: "u1",
  config: { baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "test-key" },
  setConfig: () => {
    throw new Error("poll must not call setConfig");
  },
};
const filter = { direct: true, groups: false, chats: [] as string[] };
const now = () => Math.floor(Date.now() / 1000);
beforeEach(() => {
  messages = [];
  mediaUrl = undefined;
  fileBytes = new Uint8Array([1, 2, 3, 4]);
  seen.length = 0;
  keys.length = 0;
  configureWhatsapp({ allowPrivate: true });
});

describe("whatsapp voice notes", () => {
  test("a voice note is an event with a reference to fetch; a picture or a caption is not turned into one", async () => {
    const since = now() - 100;
    const t = since + 10;
    messages = [
      { id: "v1", timestamp: t, body: "", hasMedia: true, type: "ptt" },
      { id: "a1", timestamp: t, body: "", hasMedia: true, _data: { mimetype: "audio/mpeg" } },
      { id: "p1", timestamp: t, body: "", hasMedia: true, type: "image" },
      { id: "c1", timestamp: t, body: "listen", hasMedia: true, type: "ptt" },
    ];
    const r = await WHATSAPP.inbound!.poll(
      ctx,
      { v: 1, since, chats: {} },
      { filter, maxEvents: 50 },
    );
    expect(r.events.map((e) => [e.text, e.audio?.ref])).toEqual([
      ["(voice note)", `${CHAT}|v1`],
      ["(voice note)", `${CHAT}|a1`],
      ["(sent a file or picture)", undefined],
      ["listen", `${CHAT}|c1`],
    ]);
  });

  test("fetching it asks WAHA for the message with its media, then reads the file from the server this plugin is set up with", async () => {
    // The answer names another host: only the path is used, and always against the configured server.
    mediaUrl = "http://localhost:3000/api/files/session/abc.ogg";
    const got = await WHATSAPP.inbound!.fetchAudio!(ctx, `${CHAT}|v1`);
    expect(Array.from(got.bytes)).toEqual([1, 2, 3, 4]);
    expect(got.mimeType).toBe("audio/ogg");
    expect(seen).toEqual([
      `GET /api/default/chats/${encodeURIComponent(CHAT)}/messages/v1?downloadMedia=true`,
      "GET /api/files/session/abc.ogg",
    ]);
    expect(keys).toEqual(["test-key", "test-key"]);
  });

  test("a message with no file, a path outside WAHA's API, a bad reference and a file that is too big are each refused", async () => {
    await expect(WHATSAPP.inbound!.fetchAudio!(ctx, `${CHAT}|v1`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    mediaUrl = "http://x/etc/passwd";
    await expect(WHATSAPP.inbound!.fetchAudio!(ctx, `${CHAT}|v1`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(WHATSAPP.inbound!.fetchAudio!(ctx, "no-separator")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    mediaUrl = "http://x/api/files/big.ogg";
    fileBytes = new Uint8Array(11 * 1024 * 1024);
    await expect(WHATSAPP.inbound!.fetchAudio!(ctx, `${CHAT}|v1`)).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
  });
});

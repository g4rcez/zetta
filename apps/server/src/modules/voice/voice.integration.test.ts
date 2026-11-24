// The voice call against the real chat service and a real database, with a scripted engine, a fake recognizer and a fake voice. A client
// of binary frames sends spoken-shaped audio (tone bursts) and reads back what a browser would: state changes, transcripts, audio frames.
// Skipped without a database (ZETTA_TEST_DB=embedded, or ZETTA_CHAT_TEST_DATABASE_URL).
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { asc, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { conversation, message } from "@zetta/db/schema/chat";
import { auditEvent } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { voiceCall } from "@zetta/db/schema/voice";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { HarnessError } from "../chat/harness";
import { createTurnRunner } from "../chat/pipeline";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import type { ConfiguredSynthesizer, SpeechMode } from "../speech/configured";
import { pcm16ToBytes } from "./core/audio";
import { concat, silence, tone } from "./core/test-audio";
import type { VoiceTranscriber } from "./core/types";
import type { ServerMessage } from "./protocol";
import { createVoiceService, VoiceError, type VoiceSocket } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`voice-a-${uuidv7()}`, `voice-b-${uuidv7()}`];
const [A, B] = ids as [string, string];
const INSTANCE = uuidv7();

/** The socket as a browser sees it: what the server sent, and when it closed. */
class TestSocket implements VoiceSocket {
  texts: ServerMessage[] = [];
  frames: Uint8Array[] = [];
  closed: { code: number; reason: string } | null = null;
  pings = 0;
  sendText(m: ServerMessage) {
    this.texts.push(m);
  }
  sendBinary(b: Uint8Array) {
    this.frames.push(b);
  }
  ping() {
    this.pings++;
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  of<T extends ServerMessage["type"]>(type: T) {
    return this.texts.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
  states = () => this.of("state").map((s) => s.state);
  async waitFor(what: string, test: () => boolean, ms = 6000) {
    const deadline = Date.now() + ms;
    while (!test()) {
      if (Date.now() > deadline)
        throw new Error(
          `timed out waiting for ${what}; states ${JSON.stringify(this.states())}, texts ${JSON.stringify(this.texts.filter((t) => t.type !== "state"))}`,
        );
      await Bun.sleep(10);
    }
  }
}

suite("voice call against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );

  // ---- the scripted engine: a Claude Code stand-in that takes late messages from its inbox, as the real CLI does
  const prompts: string[] = [];
  const heard: string[] = [];
  let aborted = 0;
  const cli = async function* (t: {
    prompt: string;
    signal?: AbortSignal;
    inbox?: { take(): Promise<{ id: string; text: string }[]>; read(ids: string[]): void };
  }) {
    prompts.push(t.prompt);
    const takeLate = async () => {
      const got = (await t.inbox?.take()) ?? [];
      if (got.length) {
        t.inbox!.read(got.map((g) => g.id));
        heard.push(...got.map((g) => g.text));
      }
      return got;
    };
    if (/long story/.test(t.prompt)) {
      for (const sentence of [
        "Chapter one begins here.",
        "Chapter two follows it.",
        "Chapter three is next.",
        "Chapter four goes on.",
        "Chapter five ends it.",
      ]) {
        if (t.signal?.aborted) {
          aborted++;
          throw new HarnessError("cancelled");
        }
        await Bun.sleep(450);
        yield `${sentence} `;
        const got = await takeLate();
        if (got.length) yield `Noted: ${got.map((g) => g.text).join(" and ")}. `;
      }
      return;
    }
    if (/hello bot/.test(t.prompt)) {
      yield "Sure thing. ";
      await Bun.sleep(20);
      yield "Here is the answer. ";
      return;
    }
    yield "Okay. ";
  };
  const chat = createChatService(
    db,
    createTurnRunner(db, (async () => "") as never, cli as never),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { backgroundActor: (id) => access.requireActive(new Headers({ "x-test-user": id })) },
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };

  // ---- the fake recognizer and the fake voice
  const transcripts: string[] = [];
  const transcriber: VoiceTranscriber = {
    transcribe: async () => transcripts.shift() ?? "",
  };
  const spoken: { text: string; voice?: string; language?: string }[] = [];
  let mode: SpeechMode = "remote";
  let ready = true;
  let phoneOn = false;
  /** About 400 ms of tone per sentence, in four chunks: long enough for a person to speak over it. */
  const synthesizer: ConfiguredSynthesizer = {
    mode: async () => mode,
    settings: async () => ({}) as never,
    async synthesize() {
      return tone(400);
    },
    async *stream(text, o) {
      spoken.push({ text, voice: o?.voice, language: o?.language });
      for (let i = 0; i < 4; i++) {
        if (o?.signal?.aborted) return;
        await Bun.sleep(100);
        yield tone(100, 0.1);
      }
    },
  };
  const voice = createVoiceService({
    db,
    chat,
    transcriber,
    synthesizer,
    ready: async () => ready,
    phoneOn: async () => phoneOn,
    instance: () => INSTANCE,
    leadMs: Number.POSITIVE_INFINITY,
    textRate: 50,
    ticketsPerMinute: 1000,
  });

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    delete process.env.ZETTA_CODE_ACCESS;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  const actorOf = (id: string) => access.requireActive(new Headers({ "x-test-user": id }));
  const newChat = async (as: string, extra: Record<string, unknown> = {}) => {
    const b = (
      await call(as, "POST", "/api/bots", {
        name: `V${uuidv7().slice(-4)}`,
        harness: "claude-code",
        ...extra,
      })
    ).json.bot as { id: string };
    const c = (await call(as, "POST", "/api/conversations", { botId: b.id })).json.conversation
      .id as string;
    return { bot: b.id, chat: c };
  };
  const rows = (c: string) =>
    db.select().from(message).where(eq(message.conversationId, c)).orderBy(asc(message.seq));
  const meta = (m: { meta: unknown }) =>
    (m.meta as { voice?: { callId?: string; spokenChars?: number; interrupted?: boolean } } | null)
      ?.voice;

  /** Opens a call the way the page does: a ticket from the authenticated POST, then the socket. */
  const dial = async (as: string, c: string, language = "en") => {
    const { ticket } = await voice.ticket(await actorOf(as), c);
    const socket = new TestSocket();
    const handle = (await voice.open(ticket, socket))!;
    handle.message(JSON.stringify({ type: "start", language }));
    return { socket, handle };
  };
  const send = async (handle: { message(d: unknown): void }, pcm: Int16Array) => {
    for (let at = 0; at + 320 <= pcm.length; at += 320) {
      handle.message(pcm16ToBytes(pcm.slice(at, at + 320)));
      await Bun.sleep(1);
    }
  };
  /** The first stretch of a call is the room's noise (the detector measures it), then speech, then enough silence to end it. */
  const room = (handle: { message(d: unknown): void }) => send(handle, silence(600));
  const speak = (handle: { message(d: unknown): void }, text: string, ms = 1000) => {
    transcripts.push(text);
    return send(handle, concat(tone(ms), silence(400)));
  };
  const hangUp = async (c: { socket: TestSocket; handle: { message(d: unknown): void } }) => {
    c.handle.message({ type: "end" });
    await c.socket.waitFor("the call to end", () => c.socket.closed !== null);
  };

  test("a spoken turn: states, transcript and audio come back, and the chat keeps both messages with the call's mark", async () => {
    const { chat: c } = await newChat(A);
    const client = await dial(A, c);
    await room(client.handle);
    await speak(client.handle, "hello bot");
    await client.socket.waitFor("the reply to be spoken and over", () => {
      const s = client.socket.states();
      return s.includes("speaking") && s.at(-1) === "listening" && s.includes("thinking");
    });
    expect(client.socket.of("transcript")).toEqual([
      { type: "transcript", text: "hello bot", final: true },
    ]);
    // Audio frames: whole 20 ms frames of 16 kHz mono 16-bit.
    expect(client.socket.frames.length).toBeGreaterThan(10);
    expect(client.socket.frames.every((f) => f.byteLength === 640)).toBe(true);
    // The order a person feels: listening, thinking, speaking, listening.
    expect(client.socket.states().slice(0, 4)).toEqual([
      "listening",
      "thinking",
      "speaking",
      "listening",
    ]);
    // The sentences were spoken one by one, and the bot's own prompt carried the spoken-turn note.
    expect(spoken.map((s) => s.text)).toEqual(["Sure thing.", "Here is the answer."]);
    expect(prompts.at(-1)).toContain("[Spoken turn]");

    await hangUp(client);
    const all = await rows(c);
    const [asked, replied] = all;
    expect(asked).toMatchObject({ role: "user", content: "hello bot" });
    // The saved message is what the person said, without the note that only the bot gets.
    expect(asked!.content).not.toContain("[Spoken turn]");
    expect(replied).toMatchObject({ role: "assistant", status: "complete" });
    expect(replied!.content).toContain("Here is the answer.");
    const callId = (await db.select().from(voiceCall).where(eq(voiceCall.conversationId, c)))[0]!;
    expect(meta(asked!)?.callId).toBe(callId.id);
    // What the person heard of the reply is saved with it: all of it here.
    let heardChars = 0;
    for (let i = 0; i < 100 && !heardChars; i++) {
      heardChars = meta((await rows(c))[1]!)?.spokenChars ?? 0;
      if (!heardChars) await Bun.sleep(20);
    }
    expect(heardChars).toBeGreaterThan(20);
    expect(meta((await rows(c))[1]!)).toMatchObject({ callId: callId.id, interrupted: false });
    // The call row and its audit trail.
    expect(callId).toMatchObject({
      status: "ended",
      endReason: "hangup",
      channel: "web",
      trust: "owner",
      ownerInstance: INSTANCE,
    });
    expect(callId.durationSeconds).toBeGreaterThanOrEqual(0);
    const trail = (await db.select().from(auditEvent).where(eq(auditEvent.ownerUserId, A)))
      .filter((e) => e.kind === "voice_call" && e.subjectId === callId.id)
      .map((e) => e.detail);
    expect(trail.sort()).toEqual(["ended:hangup", "started"]);
  });

  test("the person speaking over the bot clears the player, and the new words reach the turn that is running", async () => {
    const { chat: c } = await newChat(A);
    const client = await dial(A, c);
    await room(client.handle);
    await speak(client.handle, "tell me a long story");
    await client.socket.waitFor("the bot to start speaking", () => client.socket.frames.length > 0);
    // The person speaks while the first sentence is still playing.
    transcripts.push("wait one thing");
    await send(client.handle, concat(tone(1000), silence(400)));
    await client.socket.waitFor(
      "the player to be cleared",
      () => client.socket.of("clear").length > 0,
    );
    await client.socket.waitFor(
      "the engine to read the new words",
      () => heard.includes("wait one thing"),
      10_000,
    );
    // The interruption is a message of the chat, marked with the call, and the same turn answered it.
    let all = await rows(c);
    for (let i = 0; i < 400 && all.some((m) => m.status === "running"); i++) {
      await Bun.sleep(25);
      all = await rows(c);
    }
    const said = all.find((m) => m.content === "wait one thing");
    expect(said).toBeDefined();
    expect(meta(said!)?.callId).toBeDefined();
    expect(all.find((m) => m.role === "assistant")!.content).toContain("Noted: wait one thing");
    await hangUp(client);
    // The reply was cut: the saved note says so, and counts less than the whole reply.
    let note = meta((await rows(c)).find((m) => m.role === "assistant")!);
    for (let i = 0; i < 100 && note?.spokenChars === undefined; i++) {
      await Bun.sleep(20);
      note = meta((await rows(c)).find((m) => m.role === "assistant")!);
    }
    expect(note?.interrupted).toBe(true);
  }, 30_000);

  test("saying stop during the reply stops the bot", async () => {
    const { chat: c } = await newChat(A);
    const before = aborted;
    const client = await dial(A, c);
    await room(client.handle);
    await speak(client.handle, "tell me a long story");
    await client.socket.waitFor("the bot to start speaking", () => client.socket.frames.length > 0);
    await speak(client.handle, "stop");
    await client.socket.waitFor("the bot to be stopped", () => aborted > before, 10_000);
    await client.socket.waitFor(
      "the call to be listening again",
      () => client.socket.states().at(-1) === "listening",
    );
    // "stop" was a command, not a message to the bot.
    const all = await rows(c);
    expect(all.some((m) => m.content === "stop")).toBe(false);
    await hangUp(client);
  }, 30_000);

  test("a room or a chat with outside people cannot be called, and neither can someone else's chat", async () => {
    const mine = await newChat(A);
    const theirs = await newChat(B);
    const room = await newChat(A);
    const outside = await newChat(A);
    await db.update(conversation).set({ kind: "discussion" }).where(eq(conversation.id, room.chat));
    await db.update(conversation).set({ kind: "inbound" }).where(eq(conversation.id, outside.chat));
    const actor = await actorOf(A);
    const code = async (c: string) =>
      voice.ticket(actor, c).then(
        () => "ok",
        (e) => (e instanceof VoiceError ? e.code : "other"),
      );
    expect(await code(room.chat)).toBe("NOT_A_CHAT");
    expect(await code(outside.chat)).toBe("NOT_A_CHAT");
    expect(await code(theirs.chat)).toBe("NOT_FOUND");
    expect(await code(uuidv7())).toBe("NOT_FOUND");
    expect(await code(mine.chat)).toBe("ok");
    // Voice that is not set up gives no ticket.
    ready = false;
    expect(await code(mine.chat)).toBe("OFF");
    expect(await voice.capabilities()).toEqual({ voice: "off", phone: "off" });
    ready = true;
    expect(await voice.capabilities()).toEqual({ voice: "on", phone: "off" });
    // Phone follows the installation's phone settings (provider, key, address, call application), not the voice setup.
    phoneOn = true;
    expect(await voice.capabilities()).toEqual({ voice: "on", phone: "on" });
    ready = false;
    expect(await voice.capabilities()).toEqual({ voice: "off", phone: "on" });
    phoneOn = false;
    ready = true;
  });

  test("a ticket opens one call only", async () => {
    const { chat: c } = await newChat(A);
    const { ticket } = await voice.ticket(await actorOf(A), c);
    const first = new TestSocket();
    const handle = await voice.open(ticket, first);
    expect(handle).not.toBeNull();
    const second = new TestSocket();
    expect(await voice.open(ticket, second)).toBeNull();
    expect(second.closed?.code).toBe(4401);
    handle!.message({ type: "end" });
    await first.waitFor("the call to end", () => first.closed !== null);
  });

  test("a second call by the same person ends the first, with the reason said", async () => {
    const { chat: c } = await newChat(A);
    const one = await dial(A, c);
    const two = await dial(A, c);
    await one.socket.waitFor("the first call to be ended", () => one.socket.closed !== null);
    expect(one.socket.closed?.code).toBe(4409);
    expect(one.socket.of("state").at(-1)).toEqual({
      type: "state",
      state: "ended",
      reason: "replaced",
    });
    expect(two.socket.closed).toBeNull();
    const calls = await db.select().from(voiceCall).where(eq(voiceCall.conversationId, c));
    expect(calls.map((x) => [x.status, x.endReason]).sort()).toEqual([
      ["active", null],
      ["ended", "replaced"],
    ]);
    expect(voice.liveCalls).toBe(1);
    await hangUp(two);
    expect(voice.liveCalls).toBe(0);
  });

  test("the socket closing ends the call; the server's recovery marks the calls of a dead server failed", async () => {
    const { chat: c, bot: botId } = await newChat(A);
    const client = await dial(A, c);
    client.handle.closed();
    await Bun.sleep(100);
    const [gone] = await db.select().from(voiceCall).where(eq(voiceCall.conversationId, c));
    expect(gone).toMatchObject({ status: "ended", endReason: "disconnected" });

    // A call that was open when its server died: no socket, an owner that is not this instance.
    const orphan = await voice.store.open({ ownerUserId: A, botId, conversationId: c });
    await db.update(voiceCall).set({ ownerInstance: uuidv7() }).where(eq(voiceCall.id, orphan.id));
    expect(await voice.recover()).toBeGreaterThanOrEqual(1);
    const [after] = await db.select().from(voiceCall).where(eq(voiceCall.id, orphan.id));
    expect(after).toMatchObject({ status: "failed", endReason: "restart" });
    expect(after!.endedAt).not.toBeNull();
    // A call that already ended is left as it was.
    const [still] = await db.select().from(voiceCall).where(eq(voiceCall.id, gone!.id));
    expect(still).toMatchObject({ status: "ended", endReason: "disconnected" });
  });

  test("with the browser's own voice the server sends the sentences as text and no audio", async () => {
    const { chat: c } = await newChat(A);
    mode = "browser";
    try {
      const client = await dial(A, c);
      await room(client.handle);
      await speak(client.handle, "hello bot");
      await client.socket.waitFor(
        "the sentences to be said",
        () => client.socket.of("say").length >= 2,
      );
      expect(client.socket.of("say").map((s) => s.text)).toEqual([
        "Sure thing.",
        "Here is the answer.",
      ]);
      expect(client.socket.frames.length).toBe(0);
      await client.socket.waitFor(
        "the call to be listening again",
        () => client.socket.states().at(-1) === "listening",
      );
      await hangUp(client);
    } finally {
      mode = "remote";
    }
  });

  test("the bot's own voice and language reach the synthesizer", async () => {
    const { chat: c } = await newChat(A, { voice: "nova", voiceLanguage: "pt-BR" });
    const client = await dial(A, c, "pt-BR");
    await room(client.handle);
    spoken.length = 0;
    await speak(client.handle, "hello bot");
    await client.socket.waitFor("the reply to be spoken", () => spoken.length >= 2);
    expect(spoken[0]).toMatchObject({ voice: "nova", language: "pt-BR" });
    await hangUp(client);
  });

  test("a call that nobody speaks in ends by itself, and one that is quiet is kept alive by pings", async () => {
    const quick = createVoiceService({
      db,
      chat,
      transcriber,
      synthesizer,
      ready: async () => true,
      instance: () => INSTANCE,
      limits: { idleMs: 300, pingMs: 60 },
    });
    const { chat: c } = await newChat(A);
    const { ticket } = await quick.ticket(await actorOf(A), c);
    const socket = new TestSocket();
    await quick.open(ticket, socket);
    await Bun.sleep(200);
    expect(socket.pings).toBeGreaterThanOrEqual(2);
    await socket.waitFor("the call to end", () => socket.closed !== null);
    expect(socket.of("state").at(-1)).toEqual({ type: "state", state: "ended", reason: "idle" });
    const [row] = await db.select().from(voiceCall).where(eq(voiceCall.conversationId, c));
    expect(row).toMatchObject({ status: "ended", endReason: "idle" });
  });

  test("a bad message is answered with an error and does not end the call", async () => {
    const { chat: c } = await newChat(A);
    const client = await dial(A, c);
    client.handle.message("{nope");
    client.handle.message({ type: "dance" });
    client.handle.message(new Uint8Array(3));
    await client.socket.waitFor("three errors", () => client.socket.of("error").length === 3);
    expect(client.socket.of("error").every((e) => e.code === "BAD_MESSAGE")).toBe(true);
    expect(client.socket.closed).toBeNull();
    await hangUp(client);
  });
});

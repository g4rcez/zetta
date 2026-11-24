// A spoken call through the real WebSocket, with the real speech model and no key: macOS `say` speaks a sentence, it is turned into 16 kHz mono
// frames and sent in real time to the voice socket; the real local Whisper model reads it; a scripted engine (a stand-in for the Claude CLI)
// answers through the real chat service; the `browser` voice sends each sentence back as text.
//   bun scripts/e2e/voice-call.ts
//
// Starts its own isolated stack: a throwaway embedded Postgres (a child process), the chat service and the API routes in this process, on a
// free port. Nothing reads apps/*/.env and nothing touches a Zetta you run for yourself. Every process it starts is stopped at the end, and
// on SIGINT and SIGTERM (`timeout` ends a run with the latter).
// Needs: macOS (`say`, `afconvert`), the embedded Postgres runtime (`bun run db:runtime`), the Whisper model (about 250 MB, downloaded once).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uuidv7 } from "../../packages/core/src/uuid";
import { asc, eq } from "../../packages/db/src/query";
import { user } from "../../packages/db/src/schema/auth";
import { message } from "../../packages/db/src/schema/chat";
import { membership } from "../../packages/db/src/schema/identity";
import { auditEvent } from "../../packages/db/src/schema/features";
import { voiceCall } from "../../packages/db/src/schema/voice";
import { createApp } from "../../apps/server/src/app";
import { createIdentityAccess } from "../../apps/server/src/modules/identity/access";
import { createTurnRunner } from "../../apps/server/src/modules/chat/pipeline";
import { createChatService } from "../../apps/server/src/modules/chat/service";
import { pcm16ToBytes } from "../../apps/server/src/modules/voice/core/audio";
import { createVoiceService } from "../../apps/server/src/modules/voice/service";
import { createLocalTranscriber } from "../../apps/server/src/modules/transcribe/transcriber";
import { throwawayDb } from "./db";
import { createReport } from "./report";

const report = createReport("voice-call", "Voice call: a spoken sentence through the real socket");
const NEEDS = "macOS, the embedded Postgres runtime, network for the first Whisper download";
if (!Bun.which("say") || !Bun.which("afconvert")) {
  report.skip("Speech clip", "`say` and `afconvert` (macOS) are needed to make a clip");
  process.exit(report.finish(NEEDS));
}

const ORIGIN = "http://zetta-e2e.example.invalid";
const SENTENCE = "Please remind me to send the invoice to the client on Friday morning.";
const REPLY = ["Sure, I will remind you on Friday morning.", "The invoice goes to the client."];

// Every process this run starts is stopped on the way out, whatever the way out is.
const state = mkdtempSync(join(tmpdir(), "zetta-voice-call-"));
process.env.ZETTA_CODE_ROOT = join(state, "code");
process.env.ZETTA_CLAUDE_PLUGIN_ROOT = join(state, "plugins");
delete process.env.ZETTA_CODE_ACCESS;
const { db, stop } = await throwawayDb();
let server: { stop(force?: boolean): unknown } | undefined;
let stopping: Promise<void> | undefined;
/** Stops the server, then the database (a child process), whatever the way out is. A server that does not stop in 3 s is left to the exit. */
function cleanup() {
  stopping ??= (async () => {
    await Promise.race([
      Promise.resolve(server?.stop(true)).catch(() => undefined),
      Bun.sleep(3000),
    ]);
    await stop().catch(() => undefined);
    rmSync(state, { recursive: true, force: true });
  })();
  return stopping;
}
process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));
process.on("SIGTERM", () => void cleanup().then(() => process.exit(143)));

/** The clip: the machine's own voice, as 16 kHz mono 16-bit samples (the format of the socket). */
function makeClip() {
  const aiff = join(state, "clip.aiff");
  const wav = join(state, "clip.wav");
  spawnSync("say", ["-o", aiff, SENTENCE]);
  spawnSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const bytes = readFileSync(wav);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = view.getUint32(at + 4, true);
    if (id === "data") {
      const start = at + 8;
      const n = Math.floor(Math.min(size, bytes.length - start) / 2);
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) pcm[i] = view.getInt16(start + i * 2, true);
      return pcm;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no audio in the clip");
}

try {
  const clip = makeClip();
  console.error(`clip ${(clip.length / 16000).toFixed(1)} s`);
  const A = `e2e-voice-${uuidv7()}`;
  const now = new Date();
  await db.insert(user).values({
    id: A,
    name: "Ada",
    email: `${A}@example.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(membership)
    .values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
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
  const actor = await access.requireActive(new Headers({ "x-test-user": A }));

  // The scripted engine: a stand-in for the Claude CLI that answers in two sentences, whatever is said.
  const prompts: string[] = [];
  const cli = async function* (t: { prompt: string }) {
    prompts.push(t.prompt);
    for (const s of REPLY) {
      await Bun.sleep(40);
      yield `${s} `;
    }
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
  const bot = await chat.createBot(actor, {
    name: "Voice test",
    visibility: "private",
    harness: "claude-code",
    model: "haiku",
  });
  const conv = (await chat.createConversation(actor, bot!.id))!;

  // The `browser` voice: the server never makes audio, it sends each sentence as text for the device to speak.
  const noAudio = async () => {
    throw new Error("the browser voice makes no audio on the server");
  };
  const voice = createVoiceService({
    db,
    chat,
    transcriber: createLocalTranscriber(),
    synthesizer: {
      mode: async () => "browser",
      settings: async () => ({}) as never,
      synthesize: noAudio,
      stream: noAudio as never,
    },
    ready: async () => true,
    textRate: 20,
  });
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    voice: { access, voice },
    webOrigin: ORIGIN,
    desktopOrigins: [],
    drain: () => {},
  }).listen({ hostname: "127.0.0.1", port: 0 });
  server = app;
  const port = app.server!.port;

  // ---- the page's part: a ticket from the authenticated POST, then the socket
  const ticket = await (async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/voice/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-test-user": A },
      body: JSON.stringify({ conversationId: conv.id }),
    });
    if (!res.ok) throw new Error(`ticket refused: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { ticket: string }).ticket;
  })();
  const t0 = Date.now();
  const log: { at: number; msg: Record<string, unknown> }[] = [];
  let binary = 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/socket?ticket=${ticket}`, {
    headers: { origin: ORIGIN },
  } as never);
  ws.binaryType = "arraybuffer";
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") {
      log.push({ at: Date.now() - t0, msg: JSON.parse(e.data) });
      console.error(`[${Date.now() - t0} ms] ${e.data.slice(0, 120)}`);
    } else binary++;
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("the socket did not open")));
  });
  ws.send(JSON.stringify({ type: "start", language: "en" }));

  // Frames of 20 ms, in real time: half a second of room, the sentence, then silence long enough to end the turn.
  const FRAME = 320;
  const frames: Int16Array[] = [];
  const pad = (ms: number) =>
    frames.push(...Array.from({ length: ms / 20 }, () => new Int16Array(FRAME)));
  pad(600);
  const speechFrom = frames.length;
  for (let at = 0; at < clip.length; at += FRAME) {
    const f = new Int16Array(FRAME);
    f.set(clip.subarray(at, Math.min(at + FRAME, clip.length)));
    frames.push(f);
  }
  const speechTo = frames.length;
  pad(8000);
  let endOfSpeechAt = 0;
  let sentAfter = 0;
  for (let i = 0; i < frames.length; i++) {
    ws.send(pcm16ToBytes(frames[i]!));
    if (i === speechTo - 1) endOfSpeechAt = Date.now();
    await Bun.sleep(20);
    sentAfter = i;
    // Stop sending silence once the whole reply was said.
    if (i > speechTo && log.filter((l) => l.msg.type === "say").length >= REPLY.length) break;
  }
  void speechFrom;
  void sentAfter;

  // The last frames carry on while the sentences are spoken: wait until the call is quiet again.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const states = log.filter((l) => l.msg.type === "state").map((l) => l.msg.state);
    if (states.at(-1) === "listening" && states.includes("speaking")) break;
    await Bun.sleep(50);
  }
  ws.send(JSON.stringify({ type: "end" }));
  await Bun.sleep(500);

  const transcript = log.find((l) => l.msg.type === "transcript");
  const says = log.filter((l) => l.msg.type === "say");
  const heard = String(transcript?.msg.text ?? "");
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

  await report.check("Whisper reads the spoken sentence through the socket", async () => {
    if (!transcript) throw new Error("no transcript came back");
    const want = new Set(words(SENTENCE));
    const ratio = new Set(words(heard).filter((w) => want.has(w))).size / want.size;
    if (ratio < 0.7) throw new Error(`only ${Math.round(ratio * 100)}% of the words: "${heard}"`);
    return `${Math.round(ratio * 100)}% of the words. Said: "${SENTENCE}" Heard: "${heard.trim()}" (clip ${(clip.length / 16000).toFixed(1)} s)`;
  });
  await report.check("The states go listening, thinking, speaking, listening", async () => {
    const states = log.filter((l) => l.msg.type === "state").map((l) => String(l.msg.state));
    const order = ["listening", "thinking", "speaking", "listening"];
    let at = 0;
    for (const s of states) if (s === order[at]) at++;
    if (at < order.length) throw new Error(`states were ${JSON.stringify(states)}`);
    return states.join(" > ");
  });
  await report.check(
    "The reply comes back as text for the device to speak, never as audio",
    async () => {
      const texts = says.map((s) => String(s.msg.text));
      if (JSON.stringify(texts) !== JSON.stringify(REPLY))
        throw new Error(`say messages were ${JSON.stringify(texts)}`);
      if (binary) throw new Error(`${binary} audio frames were sent in browser mode`);
      return texts.join(" / ");
    },
  );
  const firstSay = says[0];
  await report.check("Time from the end of speech to the first sentence", async () => {
    if (!firstSay) throw new Error("no sentence came back");
    const ms = t0 + firstSay.at - endOfSpeechAt;
    const transcriptMs = transcript ? t0 + transcript.at - endOfSpeechAt : 0;
    return `${ms} ms to the first say (${transcriptMs} ms to the transcript: the end-of-turn silence, then the recognizer already had the words)`;
  });
  await report.check(
    "The chat holds what was said and the bot's reply, marked as a call",
    async () => {
      const rows = await db
        .select()
        .from(message)
        .where(eq(message.conversationId, conv.id))
        .orderBy(asc(message.seq));
      const [call] = await db.select().from(voiceCall).where(eq(voiceCall.conversationId, conv.id));
      const meta = (m: { meta: unknown }) =>
        (m.meta as { voice?: { callId?: string; spokenChars?: number } } | null)?.voice;
      const [asked, replied] = rows;
      if (asked?.role !== "user" || replied?.role !== "assistant")
        throw new Error(`messages were ${rows.map((r) => r.role).join(", ")}`);
      if (asked.content.trim() !== heard.trim())
        throw new Error("the saved message is not what Whisper heard");
      if (meta(asked)?.callId !== call?.id)
        throw new Error("the person's message has no call mark");
      if (!prompts.at(-1)?.includes("[Spoken turn]"))
        throw new Error("the bot got no spoken-turn note");
      if (asked.content.includes("[Spoken turn]"))
        throw new Error("the note was saved in the chat");
      // What the person heard is written when the call is over; wait for it.
      let chars: number | undefined;
      for (let i = 0; i < 100 && chars === undefined; i++) {
        const row = (await db.select().from(message).where(eq(message.id, replied.id)))[0];
        chars = meta(row!)?.spokenChars;
        if (chars === undefined) await Bun.sleep(30);
      }
      if (!chars) throw new Error("the reply has no spokenChars");
      return `user message "${asked.content.trim()}", reply "${replied.content.trim()}", spokenChars ${chars}`;
    },
  );
  await report.check(
    "The call row ends as hangup and the audit trail has both events",
    async () => {
      const [call] = await db.select().from(voiceCall).where(eq(voiceCall.conversationId, conv.id));
      if (call?.status !== "ended" || call.endReason !== "hangup")
        throw new Error(`call row was ${JSON.stringify(call)}`);
      const trail = (await db.select().from(auditEvent).where(eq(auditEvent.subjectId, call.id)))
        .map((e) => e.detail)
        .sort();
      if (JSON.stringify(trail) !== JSON.stringify(["ended:hangup", "started"]))
        throw new Error(`audit events were ${JSON.stringify(trail)}`);
      return `status ${call.status}, reason ${call.endReason}, ${call.durationSeconds} s, audit ${trail.join(" + ")}`;
    },
  );

  report.note(
    "The sentence is the machine's own synthetic voice, so accents, noise and a real microphone are not covered, and the browser's microphone and speaker code was not run here (the page was not built in this step).",
  );
  report.note(
    "The bot's engine is a scripted stand-in for the Claude CLI; the chat service, the turn pipeline and the late-message path are the real ones. Barge-in and stop are covered by the integration tests with a fake recognizer and voice, not by this run.",
  );
  report.note(
    "The `browser` voice was used so that no key is needed. A provider voice (audio frames back) was tested with a fake provider only.",
  );
  ws.close();
} catch (e) {
  report.fail("The call", e instanceof Error ? e.message : String(e));
} finally {
  await cleanup();
}
process.exit(report.finish(NEEDS));

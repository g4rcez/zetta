// The voice call from the web page, in a real browser: Helium opens a chat, a fake microphone plays a spoken sentence (macOS `say`),
// the real voice socket, the real local Whisper model and the real chat service answer with a scripted engine, and the page speaks the
// reply (the `browser` voice) or plays it through its audio worklet (a tone, in the `remote` voice).
//   bun scripts/e2e/voice-page.ts      (SHOTS=<folder> keeps the screenshots there)
//
// Everything it starts is its own and is stopped at the end and on SIGINT/SIGTERM: a throwaway embedded Postgres, the API (this process, on
// a free port), the web dev server (its own process group) and headless Helium (its own profile, process group). Nothing reads
// apps/*/.env and nothing touches a Zetta you run for yourself. The browser half is voice-page-browser.ts, run under Node.
//
// Needs: macOS (`say`, `afconvert`), the embedded Postgres runtime (`bun run db:runtime`), the Whisper model (downloaded once), Helium
// (`VOICE_E2E_BROWSER` for another Chromium binary), Node 24 and playwright-core from node_modules.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { uuidv7 } from "../../packages/core/src/uuid";
import { asc, eq } from "../../packages/db/src/query";
import { user } from "../../packages/db/src/schema/auth";
import { message } from "../../packages/db/src/schema/chat";
import { membership } from "../../packages/db/src/schema/identity";
import { voiceCall } from "../../packages/db/src/schema/voice";
import { createApp } from "../../apps/server/src/app";
import { createIdentityAccess } from "../../apps/server/src/modules/identity/access";
import { createTurnRunner } from "../../apps/server/src/modules/chat/pipeline";
import { createChatService } from "../../apps/server/src/modules/chat/service";
import { createVoiceService } from "../../apps/server/src/modules/voice/service";
import { createLocalTranscriber } from "../../apps/server/src/modules/transcribe/transcriber";
import { freePort } from "../../apps/server/src/modules/integrations/plugins/vault/vault-real-setup";
import { throwawayDb } from "./db";
import { createReport } from "./report";

const REPO = resolve(import.meta.dir, "../..");
const BROWSER = process.env.VOICE_E2E_BROWSER || "/Applications/Helium.app/Contents/MacOS/Helium";
const report = createReport("voice-page", "Voice call: the web page in a real browser");
const NEEDS =
  "macOS (say, afconvert), the embedded Postgres runtime, the Whisper model, Helium, Node 24, playwright-core";

const SENTENCE = "Please remind me to send the invoice to the client on Friday morning.";
const REPLY = ["Sure, I will remind you on Friday morning.", "The invoice goes to the client."];

// ---- everything started here is stopped on the way out
const children: ChildProcess[] = [];
const cleanups: (() => Promise<void> | void)[] = [];
/** Each child leads its own process group, and the whole group is signalled: vite starts its server as a grandchild. */
function signalGroups(signal: NodeJS.Signals) {
  for (const c of children) {
    if (!c.pid) continue;
    try {
      process.kill(-c.pid, signal);
    } catch {
      if (c.exitCode === null) c.kill(signal);
    }
  }
}
let stopping: Promise<void> | undefined;
function cleanup() {
  stopping ??= (async () => {
    signalGroups("SIGTERM");
    await Bun.sleep(1500);
    signalGroups("SIGKILL");
    for (const f of cleanups.reverse()) await Promise.resolve(f()).catch(() => undefined);
  })();
  return stopping;
}
process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));
process.on("SIGTERM", () => void cleanup().then(() => process.exit(143)));

/** The clip: the machine's own voice as a 16 kHz mono WAV, with silence before it (the call needs a moment to start) and after it. */
function makeClip(dir: string) {
  const aiff = join(dir, "clip.aiff");
  const raw = join(dir, "raw.wav");
  const wav = join(dir, "clip.wav");
  spawnSync("say", ["-o", aiff, SENTENCE]);
  spawnSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, raw]);
  const bytes = readFileSync(raw);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let pcm = new Uint8Array(0);
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = view.getUint32(at + 4, true);
    if (id === "data") {
      pcm = new Uint8Array(bytes.subarray(at + 8, at + 8 + Math.min(size, bytes.length - at - 8)));
      break;
    }
    at += 8 + size + (size % 2);
  }
  const silence = (seconds: number) => new Uint8Array(Math.round(16_000 * seconds) * 2);
  const lead = silence(Number(process.env.VOICE_E2E_LEAD ?? 2));
  const tail = silence(60);
  const data = new Uint8Array(lead.length + pcm.length + tail.length);
  data.set(lead);
  data.set(pcm, lead.length);
  data.set(tail, lead.length + pcm.length);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(wav, Buffer.concat([header, Buffer.from(data)]));
  return { wav, seconds: pcm.length / 32_000 };
}

async function main() {
  if (!Bun.which("say") || !Bun.which("afconvert"))
    return report.skip("whole run", "`say` and `afconvert` (macOS) are needed to make a clip");
  if (!existsSync(BROWSER))
    return report.skip("whole run", `no browser at ${BROWSER}: set VOICE_E2E_BROWSER`);
  const playwright = [
    ...new Bun.Glob(
      "node_modules/.bun/playwright-core@*/node_modules/playwright-core/index.mjs",
    ).scanSync({ cwd: REPO, dot: true }),
  ]
    .sort()
    .at(-1);
  if (!playwright) return report.skip("whole run", "playwright-core is not in node_modules");

  const dir = mkdtempSync("/tmp/zvp-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const shots = process.env.SHOTS || join(process.env.TMPDIR || tmpdir(), "zetta-e2e-voice-shots");
  mkdirSync(shots, { recursive: true });
  const clip = makeClip(dir);
  console.error(`clip ${clip.seconds.toFixed(1)} s`);

  // ---- the API: the real routes and services, a fixed person, a scripted engine
  process.env.ZETTA_CODE_ROOT = join(dir, "code");
  process.env.ZETTA_CLAUDE_PLUGIN_ROOT = join(dir, "plugins");
  delete process.env.ZETTA_CODE_ACCESS;
  const { db, stop } = await throwawayDb();
  cleanups.push(() => stop());
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
  const session = {
    user: { id: A, name: "Ada", email: `${A}@example.invalid`, emailVerified: true, image: null },
    session: { id: "s1", userId: A, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  };
  const access = createIdentityAccess(
    { api: { getSession: async () => ({ user: { id: A } }) } },
    async () => ({ isAdmin: false }),
  );
  const actor = await access.requireActive(new Headers());

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
  const bot = (await chat.createBot(actor, {
    name: "Voice test",
    visibility: "private",
    harness: "claude-code",
    model: "haiku",
  }))!;
  const other = (await chat.createBot(actor, {
    name: "Second bot",
    visibility: "private",
    harness: "claude-code",
    model: "haiku",
  }))!;
  const conv = (await chat.createConversation(actor, bot.id))!;
  // The second bot has a chat of its own, so picking it in the sidebar opens it.
  await chat.createConversation(actor, other.id);

  // The voice of the call: `browser` (the page speaks the text) or `remote` (a tone of 16 kHz samples, to prove the audio path).
  let voiceMode: "browser" | "remote" = "browser";
  const tone = (ms: number) =>
    Int16Array.from({ length: (16_000 * ms) / 1000 }, (_, i) =>
      Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 16_000)),
    );
  async function* toneStream() {
    for (let i = 0; i < 40; i++) yield tone(20);
  }
  const synthesizer = {
    mode: async () => voiceMode,
    settings: async () => ({}) as never,
    synthesize: async () => {
      const parts = [];
      for await (const p of toneStream()) parts.push(p);
      const all = new Int16Array(parts.length * 320);
      parts.forEach((p, i) => all.set(p, i * 320));
      return all;
    },
    stream: toneStream as never,
  };
  const voice = createVoiceService({
    db,
    chat,
    transcriber: createLocalTranscriber(),
    synthesizer,
    ready: async () => true,
    textRate: 1,
  });

  const webPort = freePort();
  const apiPort = freePort();
  const origin = `http://127.0.0.1:${webPort}`;
  const unknown: string[] = [];
  const app = createApp({
    auth: {
      handler: (request: Request) =>
        new URL(request.url).pathname.endsWith("/get-session")
          ? Response.json(session)
          : new Response("{}", { headers: { "content-type": "application/json" } }),
      api: { getSession: async () => session },
    } as never,
    chat: { access, chat },
    voice: { access, voice },
    webOrigin: origin,
    desktopOrigins: [],
    drain: () => {},
  });
  (app as unknown as import("elysia").Elysia)
    .get("/api/identity/status", () => ({ state: "active", userId: A, isAdmin: false }))
    .get("/api/discussions", () => ({ discussions: [] }))
    .get("/api/preferences", () => ({ botOrder: [], roomOrder: [] }))
    .get("/api/__e2e/mode", ({ query }) => {
      voiceMode = query.m === "remote" ? "remote" : "browser";
      return { mode: voiceMode };
    })
    .get("/api/__e2e/replace", async () => {
      await voice.endAll("replaced");
      return { ok: true };
    })
    .get("/api/__e2e/restart", async () => {
      await voice.endAll("restart");
      return { ok: true };
    })
    // A path the harness does not serve answers `{}` (a wildcard route would swallow the WebSocket upgrade, so it is the not-found handler).
    .onError(({ code, request }) => {
      if (code !== "NOT_FOUND") return;
      unknown.push(`${request.method} ${new URL(request.url).pathname}`);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    })
    .listen({ hostname: "127.0.0.1", port: apiPort });
  cleanups.push(() => void (app as unknown as { stop(f: boolean): void }).stop(true));

  // ---- the web dev server and the browser
  const base = {
    HOME: process.env.HOME ?? "",
    USER: process.env.USER ?? "e2e",
    PATH: process.env.PATH ?? "",
  };
  const spawnLogged = (
    name: string,
    cmd: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
  ) => {
    const log = Bun.file(join(dir, `${name}.log`)).writer();
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    child.stdout?.on("data", (d) => log.write(d));
    child.stderr?.on("data", (d) => log.write(d));
    children.push(child);
    return child;
  };
  spawnLogged(
    "web",
    // Under Node, not Bun: the dev server's WebSocket proxy (the voice socket goes through it) never completes an upgrade on Bun.
    "node",
    [
      join(REPO, "node_modules/.bin/vp"),
      "dev",
      "--config",
      join(REPO, "docs/demo/computer/vite.demo.config.ts"),
      "--port",
      String(webPort),
      "--strictPort",
    ],
    join(REPO, "apps/web"),
    {
      ...base,
      NODE_ENV: "development",
      PORTLESS_URL: origin,
      ZETTA_SERVER_URL: origin,
      ZETTA_DEMO_WEB_PORT: String(webPort),
      ZETTA_DEMO_API_URL: `http://127.0.0.1:${apiPort}`,
      ZETTA_DEMO_VITE_CACHE: join(dir, "vite-cache"),
    },
  );
  const waitFor = async (url: string, what: string, seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      if (
        await fetch(url).then(
          (r) => r.status > 0,
          () => false,
        )
      )
        return;
      await Bun.sleep(1000);
    }
    throw new Error(`${what} did not answer on ${url} in ${seconds}s (see ${join(dir, "*.log")})`);
  };
  await waitFor(`${origin}/`, "the web app", 150);
  await fetch(`${origin}/src/main.tsx`).catch(() => undefined);

  const cdpPort = freePort();
  const browserProc = spawn(
    BROWSER,
    [
      "--headless=new",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${join(dir, "profile")}`,
      "--no-first-run",
      "--disable-http2",
      "--disable-gpu",
      // A microphone that plays the clip once (then silence), no permission prompt, and sound allowed without a click.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${clip.wav}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
      // The sandboxed audio service cannot read the clip (the fake microphone then plays silence); without the sandbox it can.
      "--disable-features=AudioServiceSandbox",
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  );
  children.push(browserProc);
  await waitFor(`http://127.0.0.1:${cdpPort}/json/version`, "the browser", 30);

  if (process.env.VOICE_E2E_HOLD) {
    // For poking at the stack by hand: print where it is and wait for SIGTERM.
    console.log(
      `HOLD web ${origin} api http://127.0.0.1:${apiPort} chat ${conv.id} cdp http://127.0.0.1:${cdpPort}`,
    );
    await new Promise(() => undefined);
  }
  const driver = spawn("node", [join(REPO, "scripts/e2e/voice-page-browser.ts")], {
    env: {
      ...base,
      VOICE_E2E_ORIGIN: origin,
      VOICE_E2E_SHOTS: shots,
      VOICE_E2E_CDP: `http://127.0.0.1:${cdpPort}`,
      VOICE_E2E_PLAYWRIGHT: join(REPO, playwright),
      VOICE_E2E_CHAT: conv.id,
      VOICE_E2E_SENTENCE: SENTENCE,
      VOICE_E2E_REPLY: JSON.stringify(REPLY),
      VOICE_E2E_CLIP_SECONDS: String(clip.seconds),
      ...(process.env.VOICE_E2E_BAIL ? { VOICE_E2E_BAIL: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
  });
  children.push(driver);
  let buffer = "";
  let done = false;
  driver.stdout?.on("data", (d: Buffer) => {
    buffer += d.toString();
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("RESULT ")) {
        const r = JSON.parse(line.slice(7)) as {
          name: string;
          result: "pass" | "fail" | "skip";
          detail: string;
        };
        report[r.result](r.name, r.detail);
      } else if (line === "DONE") done = true;
      else if (line.trim()) console.log(`[driver] ${line}`);
    }
  });
  const code = await new Promise<number | null>((r) => driver.on("exit", r));
  if (!done) report.fail("browser driver finished", `exit code ${code}; see the log above`);

  // ---- what the server saw
  await report.check(
    "The chat holds the spoken sentence and the bot's reply, marked as a call",
    async () => {
      const rows = await db
        .select()
        .from(message)
        .where(eq(message.conversationId, conv.id))
        .orderBy(asc(message.seq));
      const calls = await db.select().from(voiceCall).where(eq(voiceCall.conversationId, conv.id));
      const user = rows.find((r) => r.role === "user");
      const reply = rows.find((r) => r.role === "assistant");
      if (!user || !reply) throw new Error(`messages were ${rows.map((r) => r.role).join(", ")}`);
      const callId = (user.meta as { voice?: { callId?: string } } | null)?.voice?.callId;
      if (!callId || !calls.some((c) => c.id === callId))
        throw new Error("no call mark on the user message");
      if (user.content.includes("[Spoken turn]")) throw new Error("the note was saved in the chat");
      return `${calls.length} calls; user "${user.content.trim()}"; reply "${reply.content.trim().slice(0, 60)}"; reasons ${calls.map((c) => c.endReason).join(",")}`;
    },
  );
  if (unknown.length)
    report.note(
      `API paths the page asked for that the harness answers with {}: ${[...new Set(unknown)].join(", ")}`,
    );
  report.note(
    "The microphone is Chromium's fake device playing a macOS `say` clip (synthetic voice, no room, no echo); the speaker's output is not heard by any microphone, so the echo canceller itself is not exercised. The bot's engine is a scripted stand-in.",
  );
  report.note(`screenshots are in ${shots}`);
}

try {
  await main();
} catch (e) {
  report.fail("run", e instanceof Error ? e.message : String(e));
} finally {
  await cleanup();
  process.exit(report.finish(NEEDS));
}

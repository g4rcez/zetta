import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TranscribeError, type Transcriber } from "../../transcribe/transcriber";
import type { PcmProcess } from "../../transcribe/decode";
import type { PluginContext } from "./registry";
import {
  configureVideoTranscribe,
  limitsOf,
  pickTrack,
  resolveInsideCode,
  videoTranscribePlugin,
} from "./video-transcribe";
import { configureYtdlp } from "./ytdlp";

const VIDEO = "https://93.184.216.34/watch?v=abc123";
const VTT = `WEBVTT

00:00:00.000 --> 00:00:04.000
captions say hello to everyone here

00:00:04.000 --> 00:00:08.000
and then they say goodbye
`;
let n = 0;
const person = (config: Record<string, string> = {}) =>
  ({ userId: `v${++n}`, config }) as unknown as PluginContext;
const tool = (name: string) => videoTranscribePlugin.tools!.find((t) => t.name === name)!;
const run = (name: string, c: PluginContext, a: Record<string, unknown>) =>
  tool(name).handler(c, a) as Promise<Record<string, any>>;

let dir: string;
let calls: string[][];
/** What the fake yt-dlp does for the captions call and the audio call. */
let subs: string | undefined;
let duration: string;
let heard: number[];
let languages: (string | undefined)[];
let speechOn: boolean;
let seconds: number;
let hold: boolean;
let killed: number;
let throttled: boolean;

const transcriber: Transcriber = {
  async transcribe(pcm, o) {
    heard.push(pcm.length / 16_000);
    languages.push(o?.language);
    return `window${heard.length} ${"x".repeat(Number(process.env.WIN_CHARS ?? 5))}`;
  },
};

/** ffmpeg stand-in: `seconds` of 16 kHz mono silence in odd-sized chunks, or a stream that never ends until it is killed. */
const spawn = (): PcmProcess => {
  let release: () => void = () => {};
  const stopped = new Promise<void>((r) => (release = r));
  const total = seconds * 16_000 * 2;
  let sent = 0;
  return {
    stdout: new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (hold) {
          await stopped;
          ctrl.close();
          return;
        }
        if (sent >= total) {
          release(); // like the real program, it exits once everything is written
          return ctrl.close();
        }
        const size = Math.min(70_001, total - sent);
        sent += size;
        ctrl.enqueue(new Uint8Array(size));
      },
    }),
    exited: stopped.then(() => 0).catch(() => 0),
    kill() {
      killed++;
      release();
    },
  } as PcmProcess;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zetta-vt-"));
  calls = [];
  subs = VTT;
  duration = "600";
  heard = [];
  languages = [];
  speechOn = true;
  seconds = 70;
  hold = false;
  killed = 0;
  throttled = false;
  configureYtdlp({
    which: (name) =>
      name === "yt-dlp" || name === "ffmpeg" ? `/usr/bin/${name}` : "/usr/bin/deno",
    binDir: () => join(dir, "bin"),
    exec: async (cmd, o) => {
      calls.push(cmd);
      const work = cmd[cmd.indexOf("-P") + 1]!;
      if (cmd.includes("--write-info-json")) {
        // Like the real answer for a talk in English: one track of its own and machine translations of it.
        const auto = Object.fromEntries(
          ["en-orig", "en", "fr", "pt", "de-orig", "ar-orig"].map((k) => [k, []]),
        );
        await writeFile(
          join(work, "info.info.json"),
          JSON.stringify({
            title: "A Talk",
            id: "abc123",
            duration: Number(duration),
            language: "en",
            subtitles: {},
            automatic_captions: auto,
          }),
        );
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      }
      if (cmd.includes("--write-subs")) {
        if (throttled)
          return {
            code: 1,
            stdout: "",
            stderr: "HTTP Error 429: Too Many Requests",
            timedOut: false,
          };
        const lang = cmd[cmd.indexOf("--sub-langs") + 1]!;
        if (subs) await writeFile(join(work, `abc123.${lang}.vtt`), subs);
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      }
      const file = join(work, "audio.webm");
      await writeFile(file, "x");
      // The real runner hands every output line to onLine, which is how the saved path is found.
      o.onLine?.("[download]  50.0% of 3MiB at 1MiB/s ETA 00:01");
      o.onLine?.(file);
      return { code: 0, stdout: `${file}\n`, stderr: "", timedOut: false };
    },
  });
  configureVideoTranscribe({
    transcriber,
    speechOn: async () => speechOn,
    spawn,
    ffmpeg: async () => "/usr/bin/ffmpeg",
    codeRoot: (u) => join(dir, "code", u),
    tmpRoot: () => join(dir, "tmp"),
    waitMs: 400,
  });
});
afterEach(async () => {
  delete process.env.WIN_CHARS;
  await rm(dir, { recursive: true, force: true });
});

const saved = async (c: PluginContext, rel: string) =>
  readFile(join(dir, "code", c.userId, rel), "utf8");

describe("pickTrack", () => {
  // The shape of a real talk: dozens of machine translations, several of them marked as the original.
  const auto = Object.fromEntries(
    ["ar-orig", "bn-orig", "de-orig", "en-orig", "en", "fr", "pt", "pt-BR"].map((k) => [k, []]),
  );
  test("the video's own language: its own track, one only", () => {
    expect(pickTrack({ language: "en", automatic_captions: auto })).toBe("en-orig");
  });
  test("a person's captions beat the automatic ones", () => {
    expect(pickTrack({ language: "en", subtitles: { en: [] }, automatic_captions: auto })).toBe(
      "en",
    );
    expect(pickTrack({ subtitles: { "pt-BR": [] } }, "pt")).toBe("pt-BR");
  });
  test("a language that was asked for wins over the video's", () => {
    expect(pickTrack({ language: "en", automatic_captions: auto }, "fr")).toBe("fr");
  });
  test("with no language and several originals, nothing is guessed", () => {
    expect(pickTrack({ automatic_captions: auto })).toBeUndefined();
    expect(pickTrack({ automatic_captions: { "es-orig": [] } })).toBe("es-orig");
    expect(pickTrack({ language: "ja", automatic_captions: auto })).toBeUndefined();
  });
  test("keys that are not language codes are ignored", () => {
    expect(pickTrack({ subtitles: { live_chat: [], "en;rm": [] } }, "en")).toBeUndefined();
  });
});

describe("video transcription", () => {
  test("captions are used first and the speech model is never asked", async () => {
    const c = person();
    const r = await run("transcribe", c, { url: VIDEO });
    expect(r.state).toBe("done");
    expect(r.source).toBe("captions");
    expect(r.text).toContain("captions say hello to everyone here");
    expect(heard).toEqual([]);
    // The details first, then exactly one track: the speaker's own, never the machine translations.
    expect(calls).toHaveLength(2);
    expect(calls[1]![calls[1]!.indexOf("--sub-langs") + 1]).toBe("en-orig");
    expect(await saved(c, r.saved.srt)).toContain(
      "00:00:04,000 --> 00:00:08,000\nand then they say goodbye",
    );
    expect(await saved(c, r.saved.vtt)).toStartWith("WEBVTT");
    // Caption fragments of one sentence read as running text, not one fragment per line.
    expect(await saved(c, r.saved.txt)).toBe(
      "captions say hello to everyone here and then they say goodbye\n",
    );
    expect(r.videoSeconds).toBe(600);
    expect(r.elapsedSeconds).toBeGreaterThanOrEqual(0);
    expect(r.saved.txt).toBe(join("outputs", "transcripts", "A Talk [abc123].txt"));
  });

  test("without captions the sound is read in 30-second windows", async () => {
    subs = undefined;
    const c = person();
    const r = await run("transcribe", c, { url: VIDEO });
    expect(r.source).toBe("speech");
    expect(heard).toEqual([30, 30, 10]);
    expect(r.text).toBe("window1 xxxxx\nwindow2 xxxxx\nwindow3 xxxxx");
    const srt = await saved(c, r.saved.srt);
    expect(srt).toContain("00:00:30,000 --> 00:01:00,000\nwindow2");
    expect(srt).toContain("00:01:00,000 --> 00:01:10,000\nwindow3");
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain("bestaudio/best");
    expect(calls[2]![calls[2]!.length - 1]).toBe(VIDEO);
  });

  test("force skips the captions but still learns the title and the language spoken", async () => {
    const r = await run("transcribe", person(), { url: VIDEO, force: true });
    expect(r.source).toBe("speech");
    expect(calls.some((x) => x.includes("--write-subs"))).toBe(false);
    expect(r.title).toBe("A Talk");
    expect(r.saved.txt).toContain("[abc123]");
    // The recognizer is told the video's own language: left alone it assumes English.
    expect(languages).toEqual(["en", "en", "en"]);
  });

  test("the language asked for steers the captions and reaches the recognizer", async () => {
    await run("transcribe", person(), { url: VIDEO, language: "pt-BR" });
    const cmd = calls[1]!;
    expect(cmd[cmd.indexOf("--sub-langs") + 1]).toBe("pt");
    await expect(
      run("transcribe", person(), { url: VIDEO, language: "pt; rm -rf" }),
    ).rejects.toThrow();
  });

  test("a file in the person's files is transcribed without yt-dlp", async () => {
    const c = person();
    const folder = join(dir, "code", c.userId, "outputs", "youtube");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "talk.mp4"), "video");
    const r = await run("transcribe", c, { file: "outputs/youtube/talk.mp4" });
    expect(r.source).toBe("speech");
    expect(calls).toHaveLength(0);
    expect(r.saved.txt).toMatch(/^outputs\/transcripts\/talk\.mp4 \[[0-9a-f]+\]\.txt$/);
  });

  test("a file outside the person's files is refused, links and absolute paths included", async () => {
    const c = person();
    const root = join(dir, "code", c.userId);
    await mkdir(root, { recursive: true });
    await writeFile(join(dir, "secret.mp4"), "nope");
    await symlink(join(dir, "secret.mp4"), join(root, "link.mp4"));
    for (const file of ["../../secret.mp4", join(dir, "secret.mp4"), "link.mp4", ""])
      await expect(resolveInsideCode(root, file)).rejects.toMatchObject({
        code: expect.stringMatching(/BLOCKED_PATH/),
      });
    await expect(run("transcribe", c, { file: "nothing.mp4" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("a private address is refused, and a call needs a url or a file", async () => {
    await expect(run("transcribe", person(), { url: "http://127.0.0.1/x" })).rejects.toMatchObject({
      code: "BLOCKED_URL",
    });
    await expect(run("transcribe", person(), {})).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(run("transcribe", person(), { url: VIDEO, file: "a.mp4" })).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });

  test("speech switched off: captions still work, others say how to fix it", async () => {
    speechOn = false;
    expect((await run("transcribe", person(), { url: VIDEO })).source).toBe("captions");
    subs = undefined;
    await expect(run("transcribe", person(), { url: VIDEO })).rejects.toMatchObject({
      code: "VOICE_OFF",
    });
  });

  test("captions that cannot be fetched (the site is throttling) fall back to the sound", async () => {
    throttled = true;
    const r = await run("transcribe", person(), { url: VIDEO });
    expect(r.source).toBe("speech");
    expect(heard).toEqual([30, 30, 10]);
  });

  test("a recognizer failure becomes a sentence for the person", async () => {
    subs = undefined;
    const broken: Transcriber = {
      transcribe: async () => {
        throw new TranscribeError("FAILED", "The speech model could not run.");
      },
    };
    configureVideoTranscribe({ transcriber: broken });
    await expect(run("transcribe", person(), { url: VIDEO })).rejects.toMatchObject({
      code: "TRANSCRIBE_FAILED",
      safe: "The speech model could not run.",
    });
    configureVideoTranscribe({ transcriber });
  });

  test("a video over the limit is refused before anything is downloaded", async () => {
    subs = undefined;
    duration = "7200";
    await expect(
      run("transcribe", person({ maxMinutes: "30" }), { url: VIDEO }),
    ).rejects.toMatchObject({
      code: "TOO_LONG",
    });
    expect(calls.some((x) => x.includes("bestaudio/best"))).toBe(false);
  });

  test("a long transcript is paged: the first part now, the rest with read", async () => {
    process.env.WIN_CHARS = "5000";
    subs = undefined;
    seconds = 130; // five windows of about 5,000 characters
    const c = person();
    const r = await run("transcribe", c, { url: VIDEO });
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(8000);
    expect(r.chars).toBeGreaterThan(24_000);
    let all = r.text as string;
    let next: number | undefined = 8000;
    let pages = 0;
    while (next !== undefined) {
      const p = await run("read", c, { job: r.job, offset: next });
      expect(p.offset).toBe(next);
      all += p.text;
      next = p.next;
      pages++;
    }
    expect(pages).toBe(3);
    expect(all).toBe((await saved(c, r.saved.txt)).trimEnd());
  });

  test("a slow one answers with a job id, shows progress, and can be cancelled", async () => {
    subs = undefined;
    hold = true;
    const c = person();
    const r = await run("transcribe", c, { url: VIDEO });
    expect(r.state).toBe("running");
    expect(r.note).toContain("background");
    const listed = (await run("job", c, {})) as unknown as Record<string, any>[];
    expect(listed.map((j) => j.job)).toEqual([r.job]);
    const done = await run("cancel", c, { job: r.job });
    expect(done.state).toBe("cancelled");
    expect(killed).toBeGreaterThan(0);
  });

  test("the chat hears how far the job is while the call runs, and stops hearing when it returns", async () => {
    subs = undefined;
    const lines: { text: string; percent?: number }[] = [];
    const c = { ...person(), progress: (p: { text: string; percent?: number }) => lines.push(p) };
    const r = await run("transcribe", c as PluginContext, { url: VIDEO });
    const texts = lines.map((l) => l.text);
    expect(texts[0]).toBe("Starting");
    expect(texts).toContain("Looking for captions");
    expect(texts.some((t) => t.startsWith("Downloading the audio · "))).toBe(true);
    // The video is 600 s long and a window is 30 s: the first window is 25 + 5% of 74 points into the percent.
    expect(texts.filter((t) => t.startsWith("Transcribing"))).toContain(
      "Transcribing · 29% · 0:30 of 10:00",
    );
    expect(texts.at(-1)).toMatch(/^Saving the transcript/);
    const percents = lines.map((l) => l.percent).filter((x): x is number => x !== undefined);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    // Nothing more once the call has returned.
    const after = lines.length;
    await run("job", person(), {}).catch(() => undefined);
    expect(lines.length).toBe(after);
    expect(r.state).toBe("done");
  });

  test("a poll with a chat watching waits for the job and shows it move", async () => {
    subs = undefined;
    hold = true;
    const c = person();
    const r = await run("transcribe", c, { url: VIDEO });
    expect(r.state).toBe("running");
    hold = false;
    const lines: string[] = [];
    const watching = {
      ...c,
      progress: (p: { text: string }) => lines.push(p.text),
    } as PluginContext;
    const polled = await run("job", watching, { job: r.job });
    expect(lines.length).toBeGreaterThan(0);
    expect(polled.state).toMatch(/running|cancelled|done|failed/);
    await run("cancel", c, { job: r.job });
  });

  test("a job belongs to the person who started it", async () => {
    const r = await run("transcribe", person(), { url: VIDEO });
    await expect(run("job", person(), { job: r.job })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(run("read", person(), { job: r.job })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("nothing is left in the work folder", async () => {
    await run("transcribe", person(), { url: VIDEO });
    expect(await readdir(join(dir, "tmp"))).toEqual([]);
  });

  test("settings: empty is no limit, nonsense is refused", () => {
    expect(limitsOf({})).toEqual({ minutes: undefined, language: undefined });
    expect(limitsOf({ maxMinutes: "45", language: "pt-BR" })).toEqual({
      minutes: 45,
      language: "pt-BR",
    });
    expect(() => limitsOf({ maxMinutes: "0" })).toThrow();
    expect(() => limitsOf({ maxMinutes: "soon" })).toThrow();
    expect(() => limitsOf({ language: "english please" })).toThrow();
  });
});

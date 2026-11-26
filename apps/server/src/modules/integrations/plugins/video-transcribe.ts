import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, basename, sep } from "node:path";

import { uuidv7 } from "@zetta/core/uuid";
import { dataDir } from "@zetta/core/zetta-home";

import { writeInside } from "../../fs-inside";
import { codeDir } from "../../chat/harness";
import { streamPcmWindows, type PcmProcess } from "../../transcribe/decode";
import { TranscribeError, type Transcriber } from "../../transcribe/transcriber";
import { toSrt, toText, toVtt, parseVtt, type Cue } from "./captions";
import { formatProgress } from "./progress";
import { PluginError, registerPlugin, type PluginContext, type PluginDef } from "./registry";
import { optStr, str } from "./rest";
import { ytdlpKit } from "./ytdlp";

/**
 * Video transcription. A bot gives a video link (any site yt-dlp reads) or a file in the person's code folder and gets the words back,
 * with the same words saved as .txt, .srt and .vtt under `outputs/transcripts/`.
 *
 * Captions first: when the site already has captions for a link, they are used (seconds, no model). Otherwise, or when asked to `force`,
 * the sound is cut into 30-second windows as ffmpeg decodes it and each window goes to the server's speech to text (Studio > Voice:
 * the model on this machine, or the provider the administrator chose), so a long video never sits in memory and every window stays
 * inside what the recognizer accepts. The sound never goes anywhere the administrator did not choose.
 *
 * Like the YouTube downloader, the work is a background job (the platform cuts a plugin call off after 60 seconds): `transcribe` waits a
 * short while and a longer one answers with a job id that `job` reports on, `read` pages through and `cancel` stops.
 *
 * Safety: a link must be a public http(s) address (the same check as the downloader); a file must resolve inside the person's code
 * folder after symbolic links are followed; yt-dlp and ffmpeg get a neutral environment and the address goes after `--`.
 */
const WINDOW_SECONDS = 30;
const MAX_RUNNING = 2,
  KEEP_FINISHED = 20,
  RETURN_CHARS = 8_000,
  PAGE_CHARS = 8_000,
  KEEP_TEXT = 2_000_000;
const EXTRA_WAIT_MS = 5 * 60_000;

type Spawn = (cmd: string[]) => PcmProcess;
type Deps = {
  transcriber?: Transcriber;
  /** Whether speech to text is switched on in Studio > Voice. Without captions, a video then cannot be transcribed. */
  speechOn: () => Promise<boolean>;
  spawn?: Spawn;
  /** Where ffmpeg is, or undefined to look it up. */
  ffmpeg?: () => Promise<string | undefined>;
  /** The person's code folder. */
  codeRoot: (userId: string) => string;
  tmpRoot: () => string;
  waitMs: number;
};
const deps: Deps = {
  speechOn: async () => true,
  codeRoot: (userId) => codeDir(userId),
  tmpRoot: () => dataDir("cache/video-transcribe"),
  waitMs: 40_000,
};
/** The server gives the recognizer and the Voice switch; tests give fakes for the processes, the folders and the wait. */
export const configureVideoTranscribe = (o: Partial<Deps>) => {
  Object.assign(deps, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
};

// ---- limits ---------------------------------------------------------------------------------------------------------------------

export type Limits = { minutes?: number; language?: string };
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
export function limitsOf(config: Readonly<Record<string, string>>): Limits {
  const mins = (config.maxMinutes ?? "").trim();
  const language = (config.language ?? "").trim();
  if (mins && (!/^\d{1,6}$/.test(mins) || Number(mins) < 1))
    throw new PluginError(
      "INVALID_FIELD",
      "The longest video is not valid.",
      "Write a whole number of minutes, or leave it empty for no limit.",
    );
  if (language && !LANG.test(language))
    throw new PluginError(
      "INVALID_FIELD",
      "The language is not valid.",
      "Write a language code such as en, pt or pt-BR, or leave it empty.",
    );
  return { minutes: mins ? Number(mins) : undefined, language: language || undefined };
}

// ---- sources --------------------------------------------------------------------------------------------------------------------

/** A file of the person's code folder: refused when it is absolute or, once symbolic links are followed, lies outside the folder. */
export async function resolveInsideCode(root: string, file: string) {
  const blocked = () =>
    new PluginError(
      "BLOCKED_PATH",
      "That file is not inside your files.",
      "Use a path inside your code folder, for example outputs/youtube/video.mp4.",
    );
  if (!file || file.includes("\0") || isAbsolute(file)) throw blocked();
  const base = await realpath(root).catch(() => {
    throw new PluginError("NOT_FOUND", "There is no file with that path.");
  });
  const real = await realpath(join(base, file)).catch(() => {
    throw new PluginError("NOT_FOUND", "There is no file with that path.");
  });
  if (real !== base && !real.startsWith(base + sep)) throw blocked();
  if (!(await stat(real)).isFile()) throw new PluginError("NOT_FOUND", "That path is not a file.");
  return { path: real, base };
}

const safeName = (s: string) =>
  s
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "transcript";

// ---- jobs -----------------------------------------------------------------------------------------------------------------------

type Result = {
  source: "captions" | "speech";
  title: string;
  language?: string;
  /** How long the video is, when the site says. */
  videoSeconds?: number;
  saved: { txt: string; srt: string; vtt: string };
  chars: number;
  text: string;
  truncated: boolean;
  cut?: boolean;
};
type Job = {
  id: string;
  userId: string;
  state: "running" | "done" | "failed" | "cancelled";
  stage: "starting" | "captions" | "downloading" | "transcribing" | "saving";
  /** How much of the video is done, when its length is known. */
  percent?: number;
  /** Seconds of sound turned into text so far. */
  transcribed?: number;
  fullText?: string;
  result?: Omit<Result, "text" | "truncated">;
  error?: { code: string; safe: string; fix?: string };
  startedAt: number;
  /** How long the sound is, when known: what the percent of the transcription is measured against. */
  total?: number;
  /** Where the chat that is watching this job hears about it: the call that is running now (see `PluginContext.progress`). */
  report?: PluginContext["progress"];
  abort: AbortController;
  done: Promise<void>;
};
const jobs = new Map<string, Job>();
const STAGE_TEXT: Record<Job["stage"], string> = {
  starting: "Starting",
  captions: "Looking for captions",
  downloading: "Downloading the audio",
  transcribing: "Transcribing",
  saving: "Saving the transcript",
};
/** Tells the chat where the job is. */
const tell = (j: Job) =>
  j.report?.({
    text: formatProgress({
      stage: STAGE_TEXT[j.stage],
      percent: j.stage === "starting" || j.stage === "captions" ? undefined : j.percent,
      ...(j.stage === "transcribing" && j.transcribed !== undefined
        ? { doneSeconds: j.transcribed, totalSeconds: j.total }
        : {}),
    }),
    ...(j.percent !== undefined && j.stage !== "captions" ? { percent: j.percent } : {}),
  });
const mine = (userId: string) => [...jobs.values()].filter((j) => j.userId === userId);
function prune(userId: string) {
  const finished = mine(userId).filter((j) => j.state !== "running");
  for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)))
    jobs.delete(j.id);
}
const view = (j: Job) => ({
  job: j.id,
  state: j.state,
  ...(j.state === "running" ? { stage: j.stage } : {}),
  ...(j.percent !== undefined ? { percent: j.percent } : {}),
  ...(j.transcribed !== undefined ? { transcribedSeconds: Math.round(j.transcribed) } : {}),
  ...(j.result ? { ...j.result, ...firstPage(j) } : {}),
  ...(j.error ? { error: j.error.safe, fix: j.error.fix } : {}),
  elapsedSeconds: Math.round((Date.now() - j.startedAt) / 1000),
});
function firstPage(j: Job) {
  const all = j.fullText ?? "";
  return { text: all.slice(0, RETURN_CHARS), truncated: all.length > RETURN_CHARS };
}
const jobArg = (c: PluginContext, a: Record<string, unknown>) => {
  const j = jobs.get(str(a, "job", 40));
  if (!j || j.userId !== c.userId)
    throw new PluginError("NOT_FOUND", "There is no transcription with that job id.");
  return j;
};

const asPluginError = (e: unknown) => {
  if (e instanceof PluginError) return e;
  if (e instanceof TranscribeError)
    return new PluginError(
      e.code === "DISABLED" ? "VOICE_OFF" : "TRANSCRIBE_FAILED",
      e.safe,
      e.code === "DISABLED" || e.code === "NOT_CONFIGURED"
        ? "An administrator can set speech to text in Studio > Voice."
        : undefined,
    );
  return new PluginError("TRANSCRIBE_FAILED", "The video could not be turned into text.");
};

type Source = { kind: "link"; url: string } | { kind: "file"; path: string; name: string };

type TrackInfo = {
  language?: string;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
};
const TRACK = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
/**
 * The one caption track worth fetching, or undefined. A site lists many: a video can offer dozens of machine translations, and asking
 * for them by pattern fetches them all (YouTube then answers 429). So the choice is made here from the list, in this order: a person's
 * captions in the language, the automatic ones in the speaker's own language (`xx-orig`), then the automatic ones of that language.
 * The language is the one asked for, else the one the video says it is in. With neither, only a lone track is taken.
 */
export function pickTrack(info: TrackInfo, wanted?: string): string | undefined {
  const base = (wanted ?? info.language ?? "").split(/[-_]/)[0]?.toLowerCase();
  const manual = Object.keys(info.subtitles ?? {}).filter((k) => TRACK.test(k));
  const auto = Object.keys(info.automatic_captions ?? {}).filter((k) => TRACK.test(k));
  if (base) {
    const own = (k: string) => k.toLowerCase().split("-")[0] === base;
    return (
      manual.find((k) => k.toLowerCase() === base) ??
      manual.find(own) ??
      auto.find((k) => k.toLowerCase() === `${base}-orig`) ??
      auto.find((k) => k.toLowerCase() === base) ??
      auto.find(own)
    );
  }
  if (manual.length === 1) return manual[0];
  const orig = auto.filter((k) => k.endsWith("-orig"));
  return orig.length === 1 ? orig[0] : undefined;
}

type Info = { title?: string; id?: string; duration?: number; language?: string };
type Details = TrackInfo & { title?: string; id?: string; duration?: number; is_live?: boolean };

/** What the site says about a link: the title, the length, the language spoken and the caption tracks. Fills `info`. */
async function readDetails(job: Job, url: string, work: string, info: Info) {
  job.stage = "captions";
  tell(job);
  await ytdlpKit.settled(15_000, ytdlpKit.denoDep.pending());
  const js = await ytdlpKit.jsArgs();
  // The details go to a file, not to the output: a talk with automatic translations lists about 160 languages, more than the runner keeps.
  const meta = await ytdlpKit.runYtdlp(
    [
      ...ytdlpKit.COMMON,
      ...ytdlpKit.cacheArgs(),
      ...js,
      "--skip-download",
      "--write-info-json",
      "-P",
      work,
      "-o",
      "info.%(ext)s",
      "--",
      url,
    ],
    { cwd: work, timeoutMs: EXTRA_WAIT_MS, signal: job.abort.signal },
  );
  if (job.abort.signal.aborted) return undefined;
  if (meta.code !== 0 || meta.timedOut) throw ytdlpKit.failure(meta, {});
  let v: Details;
  try {
    v = JSON.parse(await readFile(join(work, "info.info.json"), "utf8"));
  } catch {
    throw new PluginError("DOWNLOAD_ERROR", "yt-dlp answered with something unexpected.");
  }
  if (v.is_live)
    throw new PluginError(
      "INVALID_ARGS",
      "That is a live broadcast, which cannot be transcribed until it ends.",
    );
  info.title = ytdlpKit.clean(v.title, 120);
  info.id = String(v.id ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 30);
  if (typeof v.duration === "number" && v.duration > 0) info.duration = v.duration;
  if (typeof v.language === "string" && LANG.test(v.language)) info.language = v.language;
  return v;
}

/**
 * Captions of a link: the cues and their language, or undefined when the site has none. One track is fetched, chosen from the details.
 * A track that cannot be fetched is not an error: the sound is transcribed instead.
 */
async function fetchCaptions(
  job: Job,
  url: string,
  details: Details,
  language: string | undefined,
  work: string,
) {
  const track = pickTrack(details, language);
  if (!track) return undefined;
  const js = await ytdlpKit.jsArgs();
  const r = await ytdlpKit.runYtdlp(
    [
      ...ytdlpKit.COMMON,
      ...ytdlpKit.cacheArgs(),
      ...js,
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      track,
      "--sub-format",
      "vtt",
      "-P",
      work,
      "-o",
      "%(id)s.%(ext)s",
      "--",
      url,
    ],
    { cwd: work, timeoutMs: EXTRA_WAIT_MS, signal: job.abort.signal },
  );
  if (job.abort.signal.aborted) return undefined;
  if (r.code !== 0 || r.timedOut) return undefined;
  const file = (await readdir(work)).find((f) => f.endsWith(".vtt"));
  if (!file) return undefined;
  const cues = parseVtt(await readFile(join(work, file), "utf8"));
  if (toText(cues).length < 20) return undefined;
  return { cues, language: track };
}

/** The sound of a link, saved in the work folder. */
async function fetchAudio(job: Job, url: string, work: string) {
  job.stage = "downloading";
  tell(job);
  const ff = await ytdlpKit.findFfmpeg();
  let printed = "";
  const r = await ytdlpKit.runYtdlp(
    [
      ...ytdlpKit.COMMON,
      ...ytdlpKit.cacheArgs(),
      ...(ff?.dir ? ["--ffmpeg-location", ff.dir] : []),
      ...(await ytdlpKit.jsArgs()),
      "--no-quiet",
      "-f",
      "bestaudio/best",
      "-P",
      work,
      "-o",
      "audio.%(ext)s",
      "--print",
      "after_move:filepath",
      "--",
      url,
    ],
    {
      cwd: work,
      signal: job.abort.signal,
      onLine: (line) => {
        const m = /^\[download\]\s+([\d.]+)%/.exec(line);
        if (m) {
          job.percent = Math.round(Number(m[1]) / 4); // the download is the first quarter
          tell(job);
        } else if (!line.startsWith("[") && line.trim()) printed = line.trim();
      },
    },
  );
  if (job.abort.signal.aborted) return undefined;
  if (r.code !== 0 || r.timedOut || !printed) throw ytdlpKit.failure(r, {});
  return printed;
}

async function ffmpegPath() {
  if (deps.ffmpeg) return deps.ffmpeg();
  const ff = await ytdlpKit.findFfmpeg();
  if (!ff) return undefined;
  return ff.dir ? join(ff.dir, ytdlpKit.exe("ffmpeg")) : (Bun.which("ffmpeg") ?? undefined);
}

async function speech(
  job: Job,
  input: string,
  o: { language?: string; maxSeconds?: number; duration?: number },
) {
  if (!deps.transcriber) throw new PluginError("NOT_READY", "Speech to text is not available.");
  if (!(await deps.speechOn()))
    throw new PluginError(
      "VOICE_OFF",
      "This video has no captions, and speech to text is switched off on this server.",
      "An administrator can switch it on in Studio > Voice.",
    );
  await ytdlpKit.ffmpegDep.ensure().catch(() => undefined);
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg)
    throw new PluginError(
      "CLI_MISSING",
      "This needs ffmpeg, which is not installed on this computer.",
      "Install the plugin again (it installs ffmpeg), or install ffmpeg with your package manager.",
    );
  job.stage = "transcribing";
  job.total = o.duration ?? o.maxSeconds;
  tell(job);
  const cues: Cue[] = [];
  let at = 0;
  for await (const pcm of streamPcmWindows(ffmpeg, input, {
    windowSeconds: WINDOW_SECONDS,
    maxSeconds: o.maxSeconds,
    signal: job.abort.signal,
    spawn: deps.spawn,
  })) {
    const length = pcm.length / 16_000;
    const text = (
      await deps.transcriber.transcribe(pcm, { signal: job.abort.signal, language: o.language })
    )
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push({ start: at, end: at + length, text });
    at += length;
    job.transcribed = at;
    const total = job.total;
    if (total) job.percent = Math.min(99, 25 + Math.round((at / total) * 74));
    tell(job);
  }
  return cues;
}

async function pipeline(job: Job, c: PluginContext, src: Source, force: boolean, lang?: string) {
  const limits = limitsOf(c.config);
  const language = lang ?? limits.language;
  const maxSeconds = limits.minutes ? limits.minutes * 60 : undefined;
  await mkdir(deps.tmpRoot(), { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(deps.tmpRoot(), "job-"));
  try {
    const info: Info = {};
    let cues: Cue[] | undefined;
    let source: Result["source"] = "speech";
    let found: string | undefined;
    let cut = false;
    // The language the recognizer is told: the one asked for, else the video's own (it assumes English when it is told nothing).
    let spoken = language;
    if (src.kind === "link") {
      const details = await readDetails(job, src.url, work, info);
      if (!details) return;
      spoken ??= info.language;
      const got = force ? undefined : await fetchCaptions(job, src.url, details, language, work);
      if (got) {
        cues = got.cues;
        found = got.language;
        source = "captions";
      }
    }
    if (!cues) {
      if (job.abort.signal.aborted) return;
      let input: string;
      if (src.kind === "link") {
        if (maxSeconds && info.duration && info.duration > maxSeconds)
          throw new PluginError(
            "TOO_LONG",
            `That video is ${Math.round(info.duration / 60)} minutes long, over the ${limits.minutes}-minute limit in the plugin settings.`,
            "Raise or clear the limit in the plugin settings.",
          );
        const got = await fetchAudio(job, src.url, work);
        if (!got) return;
        input = got;
      } else input = src.path;
      cues = await speech(job, input, { language: spoken, maxSeconds, duration: info.duration });
      cut = Boolean(maxSeconds && (job.transcribed ?? 0) >= maxSeconds - 1);
    }
    if (job.abort.signal.aborted) return;
    if (!cues.length)
      throw new PluginError(
        "NO_SPEECH",
        "No words were found in that video.",
        "Check that the video has speech, or try another language.",
      );
    job.stage = "saving";
    tell(job);
    const title = info.title || (src.kind === "file" ? src.name : "transcript");
    const stem = `${safeName(title)} [${info.id ?? uuidv7().slice(-8)}]`;
    const rel = (ext: string) => join("outputs", "transcripts", `${stem}.${ext}`);
    const text = toText(cues, source === "captions" ? " " : "\n");
    for (const [ext, body] of [
      ["txt", `${text}\n`],
      ["srt", toSrt(cues)],
      ["vtt", toVtt(cues)],
    ] as const)
      // Bots write in the code folder: no link of theirs is followed.
      await writeInside(deps.codeRoot(c.userId), rel(ext), body);
    job.fullText = text.slice(0, KEEP_TEXT);
    job.result = {
      source,
      title: ytdlpKit.clean(title, 120),
      ...(found ? { language: found } : language ? { language } : {}),
      ...(info.duration ? { videoSeconds: Math.round(info.duration) } : {}),
      saved: { txt: rel("txt"), srt: rel("srt"), vtt: rel("vtt") },
      chars: text.length,
      ...(cut ? { cut: true } : {}),
    };
    job.percent = 100;
    job.state = "done";
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function startJob(c: PluginContext, src: Source, force: boolean, lang?: string) {
  if (mine(c.userId).filter((j) => j.state === "running").length >= MAX_RUNNING)
    throw new PluginError(
      "RATE_LIMITED",
      `${MAX_RUNNING} transcriptions are already running.`,
      "Wait for one to finish, or stop one with the cancel tool.",
    );
  let id = uuidv7().slice(-8);
  while (jobs.has(id)) id = uuidv7().slice(-8);
  const job: Job = {
    id,
    userId: c.userId,
    state: "running",
    stage: "starting",
    startedAt: Date.now(),
    abort: new AbortController(),
    done: Promise.resolve(),
  };
  jobs.set(id, job);
  job.report = c.progress;
  tell(job);
  job.done = pipeline(job, c, src, force, lang)
    .then(() => {
      if (job.abort.signal.aborted && job.state === "running") job.state = "cancelled";
    })
    .catch((e) => {
      if (job.abort.signal.aborted) {
        job.state = "cancelled";
        return;
      }
      const err = asPluginError(e);
      job.state = "failed";
      job.error = { code: err.code, safe: err.safe, fix: err.fix };
    })
    .finally(() => prune(c.userId));
  await ytdlpKit.settled(deps.waitMs, job.done);
  job.report = undefined; // the call is over: the chat is no longer listening
  if (job.state === "failed")
    throw new PluginError(job.error!.code, job.error!.safe, job.error!.fix);
  if (job.state === "done") return view(job);
  return {
    ...view(job),
    note: "Still going in the background. Ask for this job again to see its progress.",
  };
}

export const videoTranscribePlugin: PluginDef = registerPlugin({
  id: "video-transcription",
  name: "Video transcription",
  description:
    "Turn a video into text from its link or from a file in your files. Uses the site's captions when there are some, and speech to text otherwise.",
  icon: "subtitles",
  builtin: true,
  category: "other",
  auth: "api-key",
  fields: [
    {
      key: "maxMinutes",
      label: "Longest video (minutes)",
      kind: "text",
      optional: true,
      placeholder: "No limit",
      help: "A video longer than this is not transcribed (a file is cut at this length). A whole number of minutes. Empty: no limit.",
    },
    {
      key: "language",
      label: "Language",
      kind: "text",
      optional: true,
      placeholder: "Same as Studio > Voice",
      help: "The language spoken in your videos, for example en, pt or pt-BR. A bot can still ask for another one. Empty: the Voice setting decides.",
    },
  ],
  docsUrl: "https://github.com/yt-dlp/yt-dlp",
  notes:
    "Uses yt-dlp and ffmpeg (installed with the plugin when the computer has none). A video with captions is read in seconds. Without captions the sound goes to speech to text as set in Studio > Voice, 30 seconds at a time. Transcripts are saved in your files under outputs/transcripts as .txt, .srt and .vtt.",
  guide: () => [
    "Install the plugin: Zetta uses the yt-dlp and ffmpeg on this computer, or installs them for you.",
    "Check Studio > Voice: without captions, a video needs speech to text to be switched on.",
    "Ask a bot to transcribe a video from its link, or a file in your files. Transcripts appear under outputs/transcripts.",
  ],
  kind: "native",
  async install(c) {
    limitsOf(c.config);
    await ytdlpKit.ytdlpPath();
    for (const dep of [ytdlpKit.ffmpegDep, ytdlpKit.denoDep]) dep.ensure().catch(() => undefined);
  },
  async status(c) {
    try {
      limitsOf(c.config);
      await ytdlpKit.ytdlpPath(false);
      const [ffmpeg, speechOn] = [await ytdlpKit.ffmpegDep.state(), await deps.speechOn()];
      const notes = [
        ffmpeg === "installing" ? "ffmpeg is being installed." : undefined,
        ffmpeg === "missing" ? "ffmpeg is not installed." : undefined,
        speechOn
          ? undefined
          : "Speech to text is switched off in Studio > Voice: only videos with captions can be transcribed.",
      ].filter(Boolean);
      return {
        state: "connected",
        ...(notes.length ? { detail: notes.join(" ") } : {}),
        info: { ffmpeg, speech: speechOn ? "on" : "off" },
      };
    } catch (e) {
      return {
        state: "error",
        detail: e instanceof PluginError ? e.safe : "yt-dlp is not available.",
      };
    }
  },
  tools: [
    {
      name: "transcribe",
      description:
        "Turn one video into text. Give `url` (a public video link) or `file` (a path inside the person's files, for example outputs/youtube/talk.mp4). A link's captions are used when the site has them; `force` runs speech to text instead. `language` is a code such as en or pt-BR. Saves .txt, .srt and .vtt under outputs/transcripts. A quick one returns the text; a long one returns a job id: ask `job` for progress, then `read` for the rest of the text.",
      effect: "write",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          file: { type: "string" },
          language: { type: "string" },
          force: { type: "boolean" },
        },
      },
      handler: async (c, a) => {
        const url = optStr(a, "url", 2000);
        const file = optStr(a, "file", 500);
        if (!url === !file)
          throw new PluginError(
            "INVALID_ARGS",
            "Give either url or file, not both and not neither.",
          );
        const language = optStr(a, "language", 12);
        if (language && !LANG.test(language))
          throw new PluginError("INVALID_ARGS", "language must be a code such as en or pt-BR.");
        const force = a.force === true;
        if (url)
          return startJob(c, { kind: "link", url: await ytdlpKit.publicUrl(a) }, force, language);
        const f = await resolveInsideCode(deps.codeRoot(c.userId), file!);
        return startJob(c, { kind: "file", path: f.path, name: basename(f.path) }, true, language);
      },
    },
    {
      name: "job",
      description:
        "Progress of a transcription that is still going, or its result: state running (with the stage and percent), done (with the saved paths and the start of the text), failed or cancelled. Without a job id: the person's recent transcriptions.",
      effect: "read",
      inputSchema: { type: "object", properties: { job: { type: "string" } } },
      handler: async (c, a) => {
        if (!optStr(a, "job", 40)) return mine(c.userId).map(view);
        const j = jobArg(c, a);
        // With a chat watching, a poll waits a while for the job so the person sees it move; otherwise it answers at once.
        if (c.progress && j.state === "running") {
          j.report = c.progress;
          tell(j);
          await ytdlpKit.settled(deps.waitMs, j.done);
          j.report = undefined;
        }
        return view(j);
      },
    },
    {
      name: "read",
      description:
        "A page of a finished transcript's text, for the part after what `transcribe` or `job` returned. `offset` is the number of characters already read.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { job: { type: "string" }, offset: { type: "number" } },
        required: ["job"],
      },
      handler: async (c, a) => {
        const j = jobArg(c, a);
        if (j.state !== "done" || j.fullText === undefined)
          throw new PluginError("NOT_READY", "That transcription is not finished.");
        const offset = Math.max(0, Math.floor(Number(a.offset) || 0));
        const text = j.fullText.slice(offset, offset + PAGE_CHARS);
        const next = offset + text.length;
        return {
          text,
          offset,
          next: next < j.fullText.length ? next : undefined,
          chars: j.fullText.length,
        };
      },
    },
    {
      name: "cancel",
      description: "Stop a transcription that is still going.",
      effect: "write",
      inputSchema: { type: "object", properties: { job: { type: "string" } }, required: ["job"] },
      handler: async (c, a) => {
        const j = jobArg(c, a);
        if (j.state === "running") {
          j.abort.abort();
          await j.done;
        }
        return view(j);
      },
    },
  ],
});

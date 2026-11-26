import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { uuidv7 } from "@zetta/core/uuid";
import { dataDir } from "@zetta/core/zetta-home";

import { codeDir } from "../../chat/harness";
import { assertPublicUrl } from "../../computer/service";
import { writeInside } from "../../fs-inside";
import { formatProgress } from "./progress";
import { PluginError, registerPlugin, type PluginContext, type PluginDef } from "./registry";
import { optStr, str } from "./rest";

/**
 * YouTube downloader, through yt-dlp (https://github.com/yt-dlp/yt-dlp). Bots can read a video's details, and save a video or its
 * audio in the person's code folder under `outputs/youtube/`.
 *
 * Dependencies, installed with the plugin:
 *   - yt-dlp: the computer's own wins. Otherwise Zetta downloads the official standalone build from the project's GitHub releases into
 *     its own `bin` folder and checks it against the release's SHA2-256SUMS (no root, nothing outside Zetta's data folder).
 *   - ffmpeg (joins the best video with the best sound, converts audio): the computer's own wins. Otherwise Linux and Windows get the
 *     yt-dlp project's FFmpeg build, checked against its checksums, in the same folder; macOS has no such build, so Homebrew installs it
 *     when the computer has Homebrew. It installs in the background (it is large), so the plugin is ready at once.
 *
 * Limits: none, unless the person sets them in the plugin's settings (largest file, longest download). Saving runs as a background job
 * because the platform cuts a plugin call off after 60 seconds: `download` and `audio` wait a short while, and a longer one answers with
 * a job id that `job` reports on and `cancel` stops.
 *
 * Safety: the address must be a public http(s) address (the program would otherwise fetch private ones for a bot), it goes after `--` so
 * it can never be read as an option, user config files are ignored, the child gets a neutral environment and working folder, and a call
 * takes one video, never a playlist. Only download what you have the right to keep.
 */
const REPO = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const FFMPEG_REPO = "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download";
const WIN = process.platform === "win32";
/** The quick tools stay inside the platform's 60 s; the jobs hand back a job id before it. */
const INFO_TIMEOUT_MS = 50_000,
  MAX_OUT = 8_000_000,
  MAX_RUNNING = 3,
  KEEP_FINISHED = 20;

type Run = { code: number; stdout: string; stderr: string; timedOut: boolean };
type ExecOptions = {
  cwd: string;
  /** Absent means no deadline. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
};
type Exec = (cmd: string[], o: ExecOptions) => Promise<Run>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const spawnExec: Exec = async (cmd, { cwd, timeoutMs, signal, onLine }) => {
  let p: ReturnType<typeof Bun.spawn>;
  try {
    p = Bun.spawn(cmd, {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  }
  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          p.kill();
        }, timeoutMs);
  const stop = () => p.kill();
  signal?.addEventListener("abort", stop);
  const read = async (s: ReadableStream, each?: (line: string) => void) => {
    const dec = new TextDecoder();
    let all = "",
      rest = "";
    for await (const chunk of s as unknown as AsyncIterable<Uint8Array>) {
      const t = dec.decode(chunk, { stream: true });
      if (all.length < MAX_OUT) all += t;
      if (!each) continue;
      const lines = (rest + t).split(/\r|\n/);
      rest = lines.pop() ?? "";
      for (const l of lines) if (l) each(l);
    }
    if (each && rest) each(rest);
    return all;
  };
  try {
    const [stdout, stderr, code] = await Promise.all([
      read(p.stdout as ReadableStream, onLine),
      read(p.stderr as ReadableStream),
      p.exited,
    ]);
    return { code, stdout, stderr: stderr.slice(-4000), timedOut };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
};
let exec: Exec = spawnExec;
let download: Fetch = (url, init) => fetch(url, init);
let which: (name: string) => string | null = (n) => Bun.which(n);
let binDir = () => dataDir("bin");
let outDir = (userId: string) => join(codeDir(userId), "outputs", "youtube");
/** Where a download is made before it is copied to the person's files. */
let stagingDir = () => dataDir("staging");
let waitMs = 40_000;
let platform: NodeJS.Platform = process.platform;
/** Tests replace the process runner, the download, the PATH lookup, the folders and how long a call waits for a job. */
export const configureYtdlp = (o: {
  exec?: Exec;
  fetch?: Fetch;
  which?: (name: string) => string | null;
  binDir?: () => string;
  outDir?: (userId: string) => string;
  stagingDir?: () => string;
  waitMs?: number;
  platform?: NodeJS.Platform;
}) => {
  if (o.exec) exec = o.exec;
  if (o.fetch) download = o.fetch;
  if (o.which) which = o.which;
  if (o.binDir) binDir = o.binDir;
  if (o.outDir) outDir = o.outDir;
  if (o.stagingDir) stagingDir = o.stagingDir;
  if (o.waitMs !== undefined) waitMs = o.waitMs;
  if (o.platform) platform = o.platform;
};

const exe = (name: string) => (WIN ? `${name}.exe` : name);
const exists = (p: string) =>
  stat(p).then(
    (s) => s.isFile(),
    () => false,
  );
/** The SHA-256 a release lists for one file (`<hash>  <name>` lines). */
export function checksumFor(sums: string, name: string) {
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (m && m[2] === name) return m[1]!.toLowerCase();
  }
  return undefined;
}
async function get(url: string, what: string) {
  let res: Response;
  try {
    res = await download(url, { signal: AbortSignal.timeout(30 * 60_000) });
  } catch {
    throw new PluginError(
      "UNREACHABLE",
      `Zetta could not download ${what} from GitHub.`,
      "Check that the server can reach github.com, then try again.",
    );
  }
  if (!res.ok)
    throw new PluginError(
      "UNREACHABLE",
      `GitHub answered HTTP ${res.status} when downloading ${what}.`,
      "Try again in a moment.",
    );
  return res;
}
/** A large download goes to disk as it arrives, never into memory; returns its SHA-256. */
async function saveStream(res: Response, path: string) {
  const hash = createHash("sha256");
  const out = Bun.file(path).writer();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    out.write(chunk);
  }
  await out.end();
  return hash.digest("hex");
}
const integrity = (what: string) =>
  new PluginError(
    "INTEGRITY",
    `The downloaded ${what} does not match the checksum that is published for it, so it was thrown away.`,
    "Try again in a moment. If it keeps failing, install it with your package manager.",
  );

// ---- yt-dlp ---------------------------------------------------------------------------------------------------------------------

/** The release file for this computer, or undefined when the project publishes none. */
export function assetName(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "win32") return "yt-dlp.exe";
  if (platform === "linux") return arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  return undefined;
}
const managedPath = () => join(binDir(), exe("yt-dlp"));

let installing: Promise<string> | undefined;
/** Downloads the official build into Zetta's own folder (once at a time) and returns its path. */
export function installManaged(): Promise<string> {
  installing ??= (async () => {
    const name = assetName();
    if (!name)
      throw new PluginError(
        "WRONG_PLATFORM",
        `yt-dlp has no download for this computer (${process.platform}).`,
        "Install yt-dlp with your package manager (for example `brew install yt-dlp`).",
      );
    const [bin, sums] = await Promise.all([
      get(`${REPO}/${name}`, "yt-dlp").then((r) => r.arrayBuffer()),
      get(`${REPO}/SHA2-256SUMS`, "yt-dlp's checksums").then((r) => r.text()),
    ]);
    const bytes = new Uint8Array(bin);
    const want = checksumFor(sums, name);
    if (!want || want !== createHash("sha256").update(bytes).digest("hex"))
      throw integrity("yt-dlp");
    const dir = binDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `.yt-dlp-${process.pid}-${Date.now()}`);
    await Bun.write(tmp, bytes);
    await chmod(tmp, 0o755);
    await rename(tmp, managedPath());
    return managedPath();
  })().finally(() => {
    installing = undefined;
  });
  return installing;
}

/** The program to run: the computer's own, else Zetta's copy, else (when `fetchIfMissing`) a fresh download of it. */
export async function ytdlpPath(
  fetchIfMissing = true,
): Promise<{ path: string; source: "host" | "zetta" }> {
  const host = which("yt-dlp");
  if (host) return { path: host, source: "host" };
  if (await exists(managedPath())) return { path: managedPath(), source: "zetta" };
  if (!fetchIfMissing)
    throw new PluginError(
      "CLI_MISSING",
      "yt-dlp is not installed on this computer.",
      "Install the YouTube downloader plugin again: Zetta downloads yt-dlp itself.",
    );
  return { path: await installManaged(), source: "zetta" };
}

// ---- ffmpeg ---------------------------------------------------------------------------------------------------------------------

/** The yt-dlp project's FFmpeg build for this computer (Linux and Windows), or undefined (macOS uses Homebrew). */
export function ffmpegAsset(platform = process.platform, arch = process.arch) {
  if (platform === "linux")
    return arch === "arm64"
      ? "ffmpeg-master-latest-linuxarm64-gpl.tar.xz"
      : arch === "x64"
        ? "ffmpeg-master-latest-linux64-gpl.tar.xz"
        : undefined;
  if (platform === "win32")
    return arch === "arm64"
      ? "ffmpeg-master-latest-winarm64-gpl.zip"
      : arch === "x64"
        ? "ffmpeg-master-latest-win64-gpl.zip"
        : undefined;
  return undefined;
}
/** Where ffmpeg is: on the computer (`{}`), in Zetta's folder (`{ dir }`), or nowhere (null). */
async function findFfmpeg(): Promise<{ dir?: string } | null> {
  if (which("ffmpeg")) return {};
  if (await exists(join(binDir(), exe("ffmpeg")))) return { dir: binDir() };
  return null;
}
async function installFfmpegNow() {
  if (platform === "darwin") {
    const brew = which("brew");
    if (!brew)
      throw new PluginError(
        "CLI_MISSING",
        "ffmpeg is not installed, and Homebrew is not available to install it.",
        "Install Homebrew (https://brew.sh) or ffmpeg (https://ffmpeg.org/download.html), then install the plugin again.",
      );
    const r = await exec([brew, "install", "ffmpeg"], {
      cwd: binDir(),
      timeoutMs: 45 * 60_000,
    }).catch(() => undefined);
    if (!r || r.code !== 0 || !which("ffmpeg"))
      throw new PluginError(
        "INSTALL_FAILED",
        "Homebrew could not install ffmpeg.",
        "Run `brew install ffmpeg` in a terminal and read what it says.",
      );
    return;
  }
  const name = ffmpegAsset(platform);
  if (!name)
    throw new PluginError(
      "WRONG_PLATFORM",
      `There is no ffmpeg download for this computer (${platform}, ${process.arch}).`,
      "Install ffmpeg with your package manager.",
    );
  const dir = binDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(dir, ".ffmpeg-"));
  try {
    const sums = await (await get(`${FFMPEG_REPO}/checksums.sha256`, "ffmpeg's checksums")).text();
    const res = await get(`${FFMPEG_REPO}/${name}`, "ffmpeg");
    const archive = join(work, name);
    const got = await saveStream(res, archive);
    const want = checksumFor(sums, name);
    if (!want || want !== got) throw integrity("ffmpeg");
    const x = await exec(["tar", "-xf", archive, "-C", work], { cwd: work }).catch(() => undefined);
    if (!x || x.code !== 0)
      throw new PluginError(
        "INSTALL_FAILED",
        "ffmpeg was downloaded but could not be unpacked.",
        "Install ffmpeg with your package manager.",
      );
    const top = (await readdir(work, { withFileTypes: true })).find((e) => e.isDirectory());
    if (!top) throw new PluginError("INSTALL_FAILED", "The ffmpeg download had nothing inside.");
    for (const tool of ["ffmpeg", "ffprobe"]) {
      const from = join(work, top.name, "bin", exe(tool));
      if (!(await exists(from)))
        throw new PluginError("INSTALL_FAILED", `The ffmpeg download has no ${tool}.`);
      await chmod(from, 0o755);
      await rename(from, join(dir, exe(tool)));
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
/** A tool Zetta can install for itself, once at a time and in the background. `ensure` rejects with the reason it could not. */
function makeDep(
  label: string,
  find: () => Promise<{ dir?: string } | null>,
  installNow: () => Promise<void>,
) {
  let inflight: Promise<void> | undefined;
  let failure: string | undefined;
  return {
    find,
    ensure(): Promise<void> {
      inflight ??= (async () => {
        failure = undefined;
        if (await find()) return;
        try {
          await installNow();
        } catch (e) {
          failure = e instanceof PluginError ? e.safe : `${label} could not be installed.`;
          throw e;
        }
      })().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
    pending: () => inflight,
    failure: () => failure,
    state: async () => {
      // Read "busy" before looking: an install that finishes during the lookup then shows as ready, never as missing.
      const busy = inflight !== undefined;
      return (await find()) ? "ready" : busy ? "installing" : "missing";
    },
  };
}
const ffmpegDep = makeDep("ffmpeg", findFfmpeg, installFfmpegNow);
export const ensureFfmpeg = () => ffmpegDep.ensure();

// ---- Deno: the JavaScript runtime yt-dlp needs to read YouTube -------------------------------------------------------------------

const DENO_REPO = "https://github.com/denoland/deno/releases/latest/download";
/** The Deno release file for this computer. */
export function denoAsset(platform = process.platform, arch = process.arch) {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
  if (!cpu) return undefined;
  if (platform === "darwin") return `deno-${cpu}-apple-darwin.zip`;
  if (platform === "linux") return `deno-${cpu}-unknown-linux-gnu.zip`;
  if (platform === "win32") return `deno-${cpu}-pc-windows-msvc.zip`;
  return undefined;
}
async function findDeno(): Promise<{ dir?: string } | null> {
  if (which("deno")) return {};
  if (await exists(join(binDir(), exe("deno")))) return { dir: binDir() };
  return null;
}
async function installDenoNow() {
  const name = denoAsset(platform);
  if (!name)
    throw new PluginError(
      "WRONG_PLATFORM",
      `There is no Deno download for this computer (${platform}, ${process.arch}).`,
      "Install Deno (https://deno.com) with your package manager.",
    );
  const dir = binDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(dir, ".deno-"));
  try {
    const sums = await (await get(`${DENO_REPO}/${name}.sha256sum`, "Deno's checksum")).text();
    const archive = join(work, name);
    const got = await saveStream(await get(`${DENO_REPO}/${name}`, "Deno"), archive);
    const want = checksumFor(sums, name);
    if (!want || want !== got) throw integrity("Deno");
    // tar reads zip files on macOS and Windows; Linux needs unzip.
    const cmd =
      platform === "linux"
        ? ["unzip", "-o", archive, "-d", work]
        : ["tar", "-xf", archive, "-C", work];
    const x = await exec(cmd, { cwd: work }).catch(() => undefined);
    const from = join(work, exe("deno"));
    if (!x || x.code !== 0 || !(await exists(from)))
      throw new PluginError(
        "INSTALL_FAILED",
        "Deno was downloaded but could not be unpacked.",
        platform === "linux"
          ? "Install unzip, or install Deno with your package manager."
          : "Install Deno with your package manager.",
      );
    await chmod(from, 0o755);
    await rename(from, join(dir, exe("deno")));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
const denoDep = makeDep("Deno", findDeno, installDenoNow);
export const ensureDeno = () => denoDep.ensure();
/** yt-dlp finds Deno on the computer's PATH by itself; Zetta's own copy is named explicitly. */
async function jsArgs() {
  const js = await findDeno();
  return js?.dir ? ["--js-runtimes", `deno:${join(js.dir, exe("deno"))}`] : [];
}
/** Waits (at most `ms`) for what is being installed, whatever the outcome. */
async function settled(ms: number, ...p: (Promise<unknown> | undefined)[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(p.filter(Boolean)),
      new Promise((r) => (timer = setTimeout(r, ms))),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- limits (none unless the person sets them) ----------------------------------------------------------------------------------

export type Limits = { size?: string; minutes?: number };
/** The person's limits from the plugin settings. An empty field is no limit; a value that is not understood is refused, never ignored. */
export function limitsOf(config: Readonly<Record<string, string>>): Limits {
  const size = (config.maxSize ?? "").trim();
  const mins = (config.maxMinutes ?? "").trim();
  if (size && !/^\d+(\.\d+)?[KMGT]?$/i.test(size))
    throw new PluginError(
      "INVALID_FIELD",
      "The largest file size is not valid.",
      "Write a number with K, M, G or T, for example 500M or 2G, or leave it empty for no limit.",
    );
  if (mins && (!/^\d{1,6}$/.test(mins) || Number(mins) < 1))
    throw new PluginError(
      "INVALID_FIELD",
      "The longest download time is not valid.",
      "Write a whole number of minutes, or leave it empty for no limit.",
    );
  return { size: size || undefined, minutes: mins ? Number(mins) : undefined };
}

// ---- running yt-dlp -------------------------------------------------------------------------------------------------------------

const COMMON = ["--ignore-config", "--no-playlist", "--no-warnings", "--no-color", "--newline"];
const cacheArgs = () => ["--cache-dir", dataDir("cache/yt-dlp")];

async function publicUrl(a: Record<string, unknown>) {
  const url = str(a, "url", 2000);
  await assertPublicUrl(url).catch(() => {
    throw new PluginError(
      "BLOCKED_URL",
      "That address is not allowed: only public http(s) addresses can be downloaded.",
      "Use the video's public link.",
    );
  });
  return url;
}

/** What yt-dlp said went wrong, in words for a person. The raw output may name paths, so only known cases are quoted. */
function failure(r: { stdout: string; stderr: string; timedOut: boolean }, limits: Limits) {
  const why = `${r.stderr}\n${r.stdout}`.toLowerCase();
  if (r.timedOut)
    return new PluginError(
      "TIMEOUT",
      limits.minutes
        ? `The download was stopped after ${limits.minutes} minutes, the limit in the plugin settings.`
        : "yt-dlp took too long and was stopped.",
      "Ask for a lower quality, or raise or clear the time limit in the plugin settings.",
    );
  if (/larger than max-filesize|file is larger/.test(why))
    return new PluginError(
      "TOO_LARGE",
      `That video is larger than the ${limits.size ?? "size"} limit in the plugin settings.`,
      "Ask for a lower quality, or raise or clear the size limit in the plugin settings.",
    );
  if (
    /sign in to confirm|confirm you.re not a bot|login required|private video|members-only/.test(
      why,
    )
  )
    return new PluginError(
      "NEEDS_AUTH",
      "The site asks for a sign-in to show this video (private, age-restricted or members-only).",
      "Use a video that can be watched without signing in.",
    );
  if (/video unavailable|not available|removed|does not exist|404/.test(why))
    return new PluginError("NOT_FOUND", "That video is not available.", "Check the link.");
  if (/unsupported url/.test(why))
    return new PluginError(
      "INVALID_ARGS",
      "yt-dlp does not support that address.",
      "Use a link to a video page.",
    );
  if (/ffmpeg|ffprobe/.test(why))
    return new PluginError(
      "CLI_MISSING",
      "This needs ffmpeg, which is not installed on this computer.",
      "Install the plugin again (it installs ffmpeg), or install ffmpeg with your package manager.",
    );
  if (/http error 429|too many requests/.test(why))
    return new PluginError(
      "RATE_LIMITED",
      "The site is limiting requests.",
      "Wait a few minutes and try again.",
    );
  return new PluginError(
    "DOWNLOAD_ERROR",
    "yt-dlp could not finish that.",
    "Check the link, or try again later.",
  );
}

async function runYtdlp(args: string[], o: Omit<ExecOptions, "cwd"> & { cwd?: string }) {
  const bin = await ytdlpPath();
  try {
    return await exec([bin.path, ...args], { ...o, cwd: o.cwd ?? binDir() });
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT")
      throw new PluginError(
        "CLI_MISSING",
        "yt-dlp could not be started.",
        "Install the plugin again.",
      );
    throw new PluginError("UNREACHABLE", "yt-dlp could not be run.");
  }
}

const QUALITY = { best: undefined, "1080p": 1080, "720p": 720, "480p": 480, "360p": 360 } as const;
const AUDIO = ["mp3", "m4a", "opus"] as const;
// oxlint-disable-next-line no-control-regex -- strips control characters on purpose
const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(CONTROL, " ")
    .trim()
    .slice(0, max);

type Info = {
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  upload_date?: string;
  view_count?: number;
  description?: string;
  webpage_url?: string;
  is_live?: boolean;
  formats?: { height?: number }[];
};

// ---- background jobs ------------------------------------------------------------------------------------------------------------

type Job = {
  id: string;
  userId: string;
  kind: "download" | "audio";
  state: "running" | "done" | "failed" | "cancelled";
  percent?: number;
  speed?: string;
  eta?: string;
  saved?: string;
  bytes?: number;
  error?: { code: string; safe: string; fix?: string };
  startedAt: number;
  abort: AbortController;
  done: Promise<void>;
  /** Where the chat that is watching this job hears about it: the call that is running now (see `PluginContext.progress`). */
  report?: PluginContext["progress"];
};
const jobs = new Map<string, Job>();
/** Tells the chat where the job is. */
const tell = (j: Job, stage = j.kind === "audio" ? "Downloading audio" : "Downloading video") =>
  j.report?.({
    text: formatProgress({ stage, percent: j.percent, speed: j.speed, eta: j.eta }),
    ...(j.percent !== undefined ? { percent: j.percent } : {}),
  });
const view = (j: Job) => ({
  job: j.id,
  kind: j.kind,
  state: j.state,
  ...(j.percent !== undefined ? { percent: j.percent } : {}),
  ...(j.speed ? { speed: j.speed } : {}),
  ...(j.eta ? { eta: j.eta } : {}),
  ...(j.saved ? { saved: j.saved, bytes: j.bytes } : {}),
  ...(j.error ? { error: j.error.safe, fix: j.error.fix } : {}),
  seconds: Math.round((Date.now() - j.startedAt) / 1000),
});
const mine = (userId: string) => [...jobs.values()].filter((j) => j.userId === userId);
function prune(userId: string) {
  const finished = mine(userId).filter((j) => j.state !== "running");
  for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)))
    jobs.delete(j.id);
}
/** One progress line of yt-dlp, in the shapes it really prints ("45.3% of ~ 12.30MiB at 1.20MiB/s ETA 00:05", "0.2% ... at Unknown B/s ETA Unknown"). */
export function progressOf(line: string) {
  const pct = /^\[download\]\s+([\d.]+)%/.exec(line);
  if (!pct) return undefined;
  return {
    percent: Number(pct[1]),
    speed: /\bat\s+(\d[\d.]*\s?\S*\/s)/.exec(line)?.[1],
    eta: /\bETA\s+(\d\S*)/.exec(line)?.[1],
  };
}

const rel = (userId: string, abs: string) => {
  const base = join(outDir(userId), "..", "..");
  return abs.startsWith(base) ? abs.slice(base.length + 1) : abs;
};

/** Copies what a download left in its private folder into the person's files. A link there or in the files is never followed. */
async function keep(userId: string, folder: string) {
  const root = join(outDir(userId), "..", "..");
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const source = await open(join(folder, entry.name), "r");
    try {
      await writeInside(root, join(outDir(userId), entry.name), source);
    } finally {
      await source.close();
    }
  }
}

/** Starts a save in the background and waits a short while for it: a quick one answers at once, a long one hands back its job id. */
async function startJob(
  c: PluginContext,
  kind: Job["kind"],
  url: string,
  build: (ffmpeg: boolean) => string[],
  extra: Record<string, unknown>,
) {
  const limits = limitsOf(c.config);
  if (mine(c.userId).filter((j) => j.state === "running").length >= MAX_RUNNING)
    throw new PluginError(
      "RATE_LIMITED",
      `${MAX_RUNNING} downloads are already running.`,
      "Wait for one to finish, or stop one with the cancel tool.",
    );
  let id = uuidv7().slice(-8);
  while (jobs.has(id)) id = uuidv7().slice(-8);
  const abort = new AbortController();
  const job: Job = {
    id,
    userId: c.userId,
    kind,
    state: "running",
    startedAt: Date.now(),
    abort,
    done: Promise.resolve(),
  };
  jobs.set(id, job);
  job.report = c.progress;
  tell(job, "Starting");
  job.done = (async () => {
    // yt-dlp writes to a folder of the server's own: it follows links, and bots may plant them in the code folder.
    let dir = "";
    try {
      // Audio cannot be made without ffmpeg: wait for the one being installed, or install it now.
      if (kind === "audio") await ffmpegDep.ensure();
      await settled(30 * 60_000, ffmpegDep.pending(), denoDep.pending());
      const ff = await findFfmpeg();
      let printed = "";
      await mkdir(stagingDir(), { recursive: true, mode: 0o700 });
      dir = await mkdtemp(join(stagingDir(), "download-"));
      const r = await runYtdlp(
        [
          ...COMMON,
          ...cacheArgs(),
          ...(limits.size ? ["--max-filesize", limits.size] : []),
          ...(ff?.dir ? ["--ffmpeg-location", ff.dir] : []),
          ...(await jsArgs()),
          // --print makes yt-dlp quiet, which hides the progress and the "larger than max-filesize" message that are read below.
          "--no-quiet",
          "--restrict-filenames",
          ...build(ff !== null),
          "-P",
          dir,
          "-o",
          "%(title).80B [%(id)s].%(ext)s",
          "--print",
          "after_move:filepath",
          "--",
          url,
        ],
        {
          cwd: dir,
          timeoutMs: limits.minutes ? limits.minutes * 60_000 : undefined,
          signal: abort.signal,
          onLine: (line) => {
            const m = progressOf(line);
            if (m) {
              job.percent = m.percent;
              job.speed = m.speed;
              job.eta = m.eta;
              tell(job);
            } else if (!line.startsWith("[") && line.trim()) printed = line.trim();
          },
        },
      );
      if (abort.signal.aborted) {
        job.state = "cancelled";
        return;
      }
      // A file over the size limit is skipped with a normal exit, so "no path printed" is the failure.
      if (r.code !== 0 || r.timedOut || !printed) throw failure(r, limits);
      await keep(c.userId, dir);
      job.saved = rel(c.userId, join(outDir(c.userId), basename(printed)));
      job.bytes = await stat(join(dir, basename(printed))).then(
        (s) => s.size,
        () => undefined,
      );
      job.percent = 100;
      job.state = "done";
    } catch (e) {
      if (abort.signal.aborted) job.state = "cancelled";
      else {
        job.state = "failed";
        job.error =
          e instanceof PluginError
            ? { code: e.code, safe: e.safe, fix: e.fix }
            : { code: "DOWNLOAD_ERROR", safe: "yt-dlp could not finish that." };
      }
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
      prune(c.userId);
    }
  })();
  await settled(waitMs, job.done);
  job.report = undefined; // the call is over: the chat is no longer listening
  if (job.state === "failed")
    throw new PluginError(job.error!.code, job.error!.safe, job.error!.fix);
  if (job.state === "done") return { ...extra, saved: job.saved, bytes: job.bytes, job: job.id };
  return {
    ...extra,
    ...view(job),
    note: "Still going in the background. Ask for this job again to see its progress.",
  };
}

const jobArg = (c: PluginContext, a: Record<string, unknown>) => {
  const j = jobs.get(str(a, "job", 40));
  if (!j || j.userId !== c.userId)
    throw new PluginError("NOT_FOUND", "There is no download with that job id.");
  return j;
};

export const ytdlpPlugin: PluginDef = registerPlugin({
  id: "youtube",
  name: "YouTube downloader",
  description:
    "Look up a video and save it, or just its audio, to your files. Works with YouTube and the other sites yt-dlp supports.",
  icon: "youtube",
  builtin: true,
  category: "other",
  auth: "api-key",
  fields: [
    {
      key: "maxSize",
      label: "Largest file",
      kind: "text",
      optional: true,
      placeholder: "No limit",
      help: "A video bigger than this is not saved. A number with K, M, G or T, for example 500M or 2G. Empty: no limit.",
    },
    {
      key: "maxMinutes",
      label: "Longest download (minutes)",
      kind: "text",
      optional: true,
      placeholder: "No limit",
      help: "A download that takes longer than this is stopped. A whole number of minutes. Empty: no limit.",
    },
  ],
  docsUrl: "https://github.com/yt-dlp/yt-dlp",
  notes:
    "Uses yt-dlp and ffmpeg. Installing the plugin gets both when the computer does not have them (yt-dlp from its GitHub releases, ffmpeg from the yt-dlp project's builds, or Homebrew on a Mac). ffmpeg arrives in the background. There are no limits unless you set them here. Only download what you have the right to keep.",
  guide: () => [
    "Install the plugin: Zetta uses the yt-dlp and ffmpeg on this computer, or installs them for you.",
    "Optionally set the largest file and the longest download. Empty means no limit.",
    "Ask a bot to look up or download a video from its link. Files appear in your code folder under outputs/youtube.",
  ],
  kind: "native",
  async install(c) {
    limitsOf(c.config);
    await ytdlpPath();
    // Large, so in the background: the plugin works at once and the status says when they are ready.
    for (const dep of [ffmpegDep, denoDep]) dep.ensure().catch(() => undefined);
  },
  async status(c) {
    try {
      limitsOf(c.config);
      const bin = await ytdlpPath(false);
      const r = await exec([bin.path, "--version"], { cwd: binDir(), timeoutMs: 15_000 }).catch(
        () => undefined,
      );
      const [ffmpeg, deno] = [await ffmpegDep.state(), await denoDep.state()];
      const notes = (
        [
          ["ffmpeg", ffmpeg, ffmpegDep.failure()],
          ["Deno", deno, denoDep.failure()],
        ] as const
      )
        .filter(([, state]) => state !== "ready")
        .map(([name, state, why]) =>
          state === "installing"
            ? `${name} is being installed.`
            : (why ?? `${name} is not installed.`),
        );
      return {
        state: "connected",
        ...(notes.length ? { detail: notes.join(" ") } : {}),
        info: {
          version: r?.stdout.trim().slice(0, 40) || undefined,
          program: bin.source === "host" ? "this computer's yt-dlp" : "Zetta's own copy",
          ffmpeg,
          deno,
        },
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
      name: "info",
      description:
        "Details of one video from its link: title, channel, length, date and the available sizes. Downloads nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      handler: async (_c, a) => {
        const url = await publicUrl(a);
        await settled(15_000, denoDep.pending());
        const r = await runYtdlp(
          [
            ...COMMON,
            ...cacheArgs(),
            ...(await jsArgs()),
            "--skip-download",
            "--dump-single-json",
            "--",
            url,
          ],
          { timeoutMs: INFO_TIMEOUT_MS },
        );
        if (r.code !== 0 || r.timedOut) throw failure(r, {});
        let v: Info;
        try {
          v = JSON.parse(r.stdout) as Info;
        } catch {
          throw new PluginError("DOWNLOAD_ERROR", "yt-dlp answered with something unexpected.");
        }
        const heights = [
          ...new Set((v.formats ?? []).map((f) => f.height).filter((h): h is number => !!h)),
        ].sort((x, y) => y - x);
        return {
          title: clean(v.title, 200),
          channel: clean(v.channel ?? v.uploader, 120),
          seconds: v.duration,
          published: v.upload_date,
          views: v.view_count,
          live: v.is_live === true,
          heights: heights.slice(0, 8),
          description: clean(v.description, 600),
          url: clean(v.webpage_url, 300),
        };
      },
    },
    {
      name: "download",
      description:
        "Save one video to the person's files (outputs/youtube). quality is best (default), 1080p, 720p, 480p or 360p. A quick one returns the saved path; a long one returns a job id: ask `job` for progress.",
      effect: "write",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          quality: { type: "string", enum: Object.keys(QUALITY) },
        },
        required: ["url"],
      },
      handler: async (c, a) => {
        const url = await publicUrl(a);
        const q = optStr(a, "quality", 10) ?? "best";
        if (!(q in QUALITY))
          throw new PluginError(
            "INVALID_ARGS",
            `quality must be one of ${Object.keys(QUALITY).join(", ")}.`,
          );
        const h = QUALITY[q as keyof typeof QUALITY];
        const cap = h ? `[height<=${h}]` : "";
        return startJob(
          c,
          "download",
          url,
          // Without ffmpeg the video and the sound cannot be joined, so ask for one file that has both.
          (ffmpeg) =>
            ffmpeg
              ? ["-f", `bv*${cap}+ba/b${cap}`, "--merge-output-format", "mp4"]
              : ["-f", `b${cap}/b`],
          { quality: q },
        );
      },
    },
    {
      name: "audio",
      description:
        "Save only the sound of one video as mp3 (default), m4a or opus in the person's files (outputs/youtube). Needs ffmpeg (installed with the plugin). A quick one returns the saved path; a long one returns a job id.",
      effect: "write",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" }, format: { type: "string", enum: [...AUDIO] } },
        required: ["url"],
      },
      handler: async (c, a) => {
        const url = await publicUrl(a);
        const f = optStr(a, "format", 5) ?? "mp3";
        if (!(AUDIO as readonly string[]).includes(f))
          throw new PluginError("INVALID_ARGS", `format must be one of ${AUDIO.join(", ")}.`);
        return startJob(c, "audio", url, () => ["-x", "--audio-format", f], { format: f });
      },
    },
    {
      name: "job",
      description:
        "Progress of a download that is still going, or its result: state running, done (with the saved path), failed or cancelled. Without a job id: the person's recent downloads.",
      effect: "read",
      inputSchema: { type: "object", properties: { job: { type: "string" } } },
      handler: async (c, a) => {
        if (!optStr(a, "job", 40)) return mine(c.userId).map(view);
        const j = jobArg(c, a);
        // With a chat watching, a poll waits a while for the job so the person sees it move; otherwise it answers at once.
        if (c.progress && j.state === "running") {
          j.report = c.progress;
          tell(j);
          await settled(waitMs, j.done);
          j.report = undefined;
        }
        return view(j);
      },
    },
    {
      name: "cancel",
      description: "Stop a download that is still going.",
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
    {
      name: "update",
      description:
        "Get the newest yt-dlp when Zetta keeps its own copy (sites change often and old versions stop working). A yt-dlp installed by the computer's package manager is updated there.",
      effect: "write",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const bin = await ytdlpPath();
        if (bin.source === "host")
          return {
            updated: false,
            note: "This computer's own yt-dlp is used; update it with your package manager (for example `brew upgrade yt-dlp`).",
          };
        await rm(managedPath(), { force: true });
        await installManaged();
        const v = await exec([managedPath(), "--version"], {
          cwd: binDir(),
          timeoutMs: 15_000,
        }).catch(() => undefined);
        return { updated: true, version: v?.stdout.trim().slice(0, 40) };
      },
    },
  ],
});

/**
 * The pieces other plugins that drive yt-dlp reuse (video transcription), so the safety rules live in one place: the public-address
 * check, the neutral way of running it, the sentences for its failures, and where ffmpeg is.
 */
export const ytdlpKit = {
  COMMON,
  cacheArgs,
  jsArgs,
  publicUrl,
  runYtdlp,
  failure,
  settled,
  clean,
  findFfmpeg,
  ffmpegDep,
  denoDep,
  ytdlpPath,
  binDir: () => binDir(),
  exe,
};

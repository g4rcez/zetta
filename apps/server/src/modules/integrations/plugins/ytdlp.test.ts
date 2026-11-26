import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginContext } from "./registry";
import {
  assetName,
  checksumFor,
  configureYtdlp,
  denoAsset,
  ensureDeno,
  ensureFfmpeg,
  ffmpegAsset,
  installManaged,
  limitsOf,
  progressOf,
  ytdlpPlugin,
  ytdlpPath,
} from "./ytdlp";

// Public address as a literal, so the address check needs no DNS.
const VIDEO = "https://93.184.216.34/watch?v=abc123";
let n = 0;
/** A person with their own id, so jobs of one test never count against another. */
const person = (config: Record<string, string> = {}) =>
  ({ userId: `u${++n}`, config }) as unknown as PluginContext;
const tool = (name: string) => ytdlpPlugin.tools!.find((t) => t.name === name)!;
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

type Answer = { code: number; stdout: string; stderr: string };
type Opts = { cwd: string; timeoutMs?: number; signal?: AbortSignal; onLine?: (l: string) => void };
let dir: string;
let calls: { cmd: string[]; o: Opts }[];
let hosted: string | null;
let ffmpeg: string | null;
let brew: string | null;
let deno: string | null;
let answer: (cmd: string[], o: Opts) => Answer | Promise<Answer>;
const ok = (stdout = ""): Answer => ({ code: 0, stdout, stderr: "" });
const BYTES = new TextEncoder().encode("#!/bin/sh\necho 2099.01.01\n");

function setup(o: { fetch?: (url: string) => Promise<Response>; platform?: NodeJS.Platform } = {}) {
  configureYtdlp({
    exec: async (cmd, opts) => {
      calls.push({ cmd, o: opts });
      const a = await answer(cmd, opts);
      for (const l of a.stdout.split("\n")) if (l) opts.onLine?.(l);
      return { ...a, timedOut: false };
    },
    which: (name) =>
      name === "yt-dlp"
        ? hosted
        : name === "ffmpeg"
          ? ffmpeg
          : name === "brew"
            ? brew
            : name === "deno"
              ? deno
              : null,
    binDir: () => join(dir, "bin"),
    outDir: (u) => join(dir, "code", u, "outputs", "youtube"),
    stagingDir: () => join(dir, "staging"),
    fetch: o.fetch ?? (async () => new Response("nope", { status: 500 })),
    waitMs: 300,
    platform: o.platform ?? process.platform,
  });
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zetta-ytdlp-"));
  calls = [];
  hosted = "/usr/bin/yt-dlp";
  ffmpeg = null;
  brew = null;
  deno = "/usr/bin/deno";
  answer = () => ok();
  setup();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("yt-dlp", () => {
  test("release file per computer; checksum lines parse", () => {
    expect(assetName("darwin", "arm64")).toBe("yt-dlp_macos");
    expect(assetName("linux", "x64")).toBe("yt-dlp_linux");
    expect(assetName("linux", "arm64")).toBe("yt-dlp_linux_aarch64");
    expect(assetName("win32", "x64")).toBe("yt-dlp.exe");
    expect(assetName("freebsd" as never, "x64")).toBeUndefined();
    const h = "a".repeat(64);
    expect(checksumFor(`${h}  yt-dlp_macos\n${"b".repeat(64)} *yt-dlp\n`, "yt-dlp_macos")).toBe(h);
    expect(checksumFor(`${h}  other`, "yt-dlp_macos")).toBeUndefined();
  });

  test("the computer's own yt-dlp wins; nothing is downloaded", async () => {
    expect(await ytdlpPath()).toEqual({ path: "/usr/bin/yt-dlp", source: "host" });
  });

  test("with none, it downloads the official build, checks the checksum and keeps it in Zetta's folder", async () => {
    hosted = null;
    const asked: string[] = [];
    const name = assetName()!;
    setup({
      fetch: async (url) => {
        asked.push(url);
        if (url.endsWith("/SHA2-256SUMS")) return new Response(`${sha(BYTES)}  ${name}\n`);
        return new Response(BYTES);
      },
    });
    const got = await ytdlpPath();
    expect(got.source).toBe("zetta");
    expect(got.path.startsWith(join(dir, "bin"))).toBe(true);
    expect(new Uint8Array(await readFile(got.path))).toEqual(BYTES);
    expect(((await stat(got.path)).mode & 0o111) !== 0).toBe(true);
    expect(
      asked.every((u) =>
        u.startsWith("https://github.com/yt-dlp/yt-dlp/releases/latest/download/"),
      ),
    ).toBe(true);
    asked.length = 0;
    expect((await ytdlpPath()).source).toBe("zetta");
    expect(asked).toEqual([]);
  });

  test("a download that does not match the published checksum is thrown away", async () => {
    hosted = null;
    setup({
      fetch: async (url) =>
        url.endsWith("/SHA2-256SUMS")
          ? new Response(`${"0".repeat(64)}  ${assetName()}\n`)
          : new Response(BYTES),
    });
    await expect(installManaged()).rejects.toMatchObject({ code: "INTEGRITY" });
    await expect(stat(join(dir, "bin", "yt-dlp"))).rejects.toBeDefined();
  });
});

describe("dependencies on install", () => {
  test("install gets yt-dlp, and returns before ffmpeg (which installs in the background)", async () => {
    hosted = null;
    brew = "/opt/homebrew/bin/brew";
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const name = assetName()!;
    setup({
      platform: "darwin",
      fetch: async (url) =>
        url.endsWith("/SHA2-256SUMS")
          ? new Response(`${sha(BYTES)}  ${name}\n`)
          : new Response(BYTES),
    });
    answer = async (cmd) => {
      if (cmd[1] === "install") {
        await held;
        ffmpeg = "/opt/homebrew/bin/ffmpeg";
      }
      return ok("2099.01.01");
    };
    await ytdlpPlugin.install!(person());
    expect((await ytdlpPath(false)).source).toBe("zetta");
    const during = await ytdlpPlugin.status!(person());
    expect(during).toMatchObject({
      state: "connected",
      detail: "ffmpeg is being installed.",
      info: { ffmpeg: "installing" },
    });
    release();
    await ensureFfmpeg();
    const after = await ytdlpPlugin.status!(person());
    expect(after).toMatchObject({ state: "connected", info: { ffmpeg: "ready" } });
    expect(calls.some((c) => c.cmd.slice(-2).join(" ") === "install ffmpeg")).toBe(true);
  });

  test("a computer that already has ffmpeg is left alone", async () => {
    ffmpeg = "/usr/bin/ffmpeg";
    await ensureFfmpeg();
    expect(calls).toEqual([]);
  });

  test("on a Mac with Homebrew it is installed with Homebrew; without, the person is told what to do", async () => {
    brew = "/opt/homebrew/bin/brew";
    setup({ platform: "darwin" });
    answer = () => {
      ffmpeg = "/opt/homebrew/bin/ffmpeg";
      return ok();
    };
    await ensureFfmpeg();
    expect(calls[0]!.cmd).toEqual(["/opt/homebrew/bin/brew", "install", "ffmpeg"]);
    ffmpeg = null;
    brew = null;
    answer = () => ok();
    await expect(ensureFfmpeg()).rejects.toMatchObject({ code: "CLI_MISSING" });
    const s = await ytdlpPlugin.status!(person());
    expect(s.detail).toContain("Homebrew");
  });

  test("Linux and Windows get the yt-dlp project's build, checked against its checksum, unpacked into Zetta's folder", async () => {
    setup({
      platform: "linux",
      fetch: async (url) =>
        url.endsWith("/checksums.sha256")
          ? new Response(`${sha(BYTES)}  ${ffmpegAsset("linux")}\n`)
          : new Response(BYTES),
    });
    answer = async (cmd) => {
      // The fake `tar` lays out what the real archive holds: <top>/bin/ffmpeg and ffprobe.
      const work = cmd[cmd.indexOf("-C") + 1]!;
      await mkdir(join(work, "ffmpeg-master-latest-linux64-gpl", "bin"), { recursive: true });
      for (const t of ["ffmpeg", "ffprobe"])
        await writeFile(join(work, "ffmpeg-master-latest-linux64-gpl", "bin", t), "bin");
      return ok();
    };
    await ensureFfmpeg();
    expect((await readdir(join(dir, "bin"))).sort()).toEqual(["ffmpeg", "ffprobe"]);
    expect(((await stat(join(dir, "bin", "ffmpeg"))).mode & 0o111) !== 0).toBe(true);
  });

  test("an ffmpeg download that does not match its checksum is thrown away", async () => {
    setup({
      platform: "linux",
      fetch: async (url) =>
        url.endsWith("/checksums.sha256")
          ? new Response(`${"0".repeat(64)}  ${ffmpegAsset("linux")}\n`)
          : new Response(BYTES),
    });
    await expect(ensureFfmpeg()).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(await readdir(join(dir, "bin"))).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("Deno, the JavaScript runtime yt-dlp needs for YouTube", () => {
  const zipAnswer =
    (made: string[] = []) =>
    async (cmd: string[]): Promise<Answer> => {
      // The fake unpacker lays out what the real zip holds: the program at the top.
      const flag = cmd.includes("-C") ? "-C" : "-d";
      const work = cmd[cmd.indexOf(flag) + 1]!;
      await writeFile(join(work, "deno"), "bin");
      made.push(cmd[0]!);
      return ok();
    };

  test("release file per computer", () => {
    expect(denoAsset("darwin", "arm64")).toBe("deno-aarch64-apple-darwin.zip");
    expect(denoAsset("linux", "x64")).toBe("deno-x86_64-unknown-linux-gnu.zip");
    expect(denoAsset("win32", "x64")).toBe("deno-x86_64-pc-windows-msvc.zip");
    expect(denoAsset("freebsd" as never, "x64")).toBeUndefined();
  });

  test("a computer that has Deno is left alone, and yt-dlp finds it by itself", async () => {
    ffmpeg = "/usr/bin/ffmpeg";
    answer = () => ok("/x/outputs/youtube/a.mp4");
    await ensureDeno();
    await tool("download").handler(person(), { url: VIDEO });
    expect(calls.every((c) => !c.cmd.includes("tar"))).toBe(true);
    expect(calls.at(-1)!.cmd).not.toContain("--js-runtimes");
  });

  test("without Deno it is downloaded, checked against its checksum, unpacked into Zetta's folder and named to yt-dlp", async () => {
    deno = null;
    ffmpeg = "/usr/bin/ffmpeg";
    const name = denoAsset("darwin")!;
    const asked: string[] = [];
    setup({
      platform: "darwin",
      fetch: async (url) => {
        asked.push(url);
        return url.endsWith(".sha256sum")
          ? new Response(`${sha(BYTES)}  ${name}\n`)
          : new Response(BYTES);
      },
    });
    const made: string[] = [];
    answer = async (cmd) =>
      cmd[0] === "tar" ? zipAnswer(made)(cmd) : ok("/x/outputs/youtube/a.mp4");
    await ensureDeno();
    expect(made).toEqual(["tar"]);
    expect(await readdir(join(dir, "bin"))).toEqual(["deno"]);
    expect(
      asked.every((u) =>
        u.startsWith("https://github.com/denoland/deno/releases/latest/download/"),
      ),
    ).toBe(true);
    await tool("download").handler(person(), { url: VIDEO });
    const run = calls.find((c) => c.cmd.includes("--print"))!.cmd;
    expect(run.slice(run.indexOf("--js-runtimes"), run.indexOf("--js-runtimes") + 2)).toEqual([
      "--js-runtimes",
      `deno:${join(dir, "bin", "deno")}`,
    ]);
  });

  test("on Linux the zip is opened with unzip", async () => {
    deno = null;
    const name = denoAsset("linux")!;
    setup({
      platform: "linux",
      fetch: async (url) =>
        url.endsWith(".sha256sum") ? new Response(`${sha(BYTES)}  ${name}\n`) : new Response(BYTES),
    });
    const made: string[] = [];
    answer = zipAnswer(made);
    await ensureDeno();
    expect(made).toEqual(["unzip"]);
  });

  test("a Deno download that does not match its checksum is thrown away", async () => {
    deno = null;
    setup({
      platform: "darwin",
      fetch: async (url) =>
        url.endsWith(".sha256sum")
          ? new Response(`${"0".repeat(64)}  ${denoAsset("darwin")}\n`)
          : new Response(BYTES),
    });
    await expect(ensureDeno()).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(await readdir(join(dir, "bin"))).toEqual([]);
  });

  test("install starts yt-dlp, ffmpeg and Deno; the status says what is still coming", async () => {
    deno = null;
    ffmpeg = null;
    brew = "/opt/homebrew/bin/brew";
    const name = denoAsset("darwin")!;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    setup({
      platform: "darwin",
      fetch: async (url) => {
        await held;
        return url.endsWith(".sha256sum")
          ? new Response(`${sha(BYTES)}  ${name}\n`)
          : new Response(BYTES);
      },
    });
    answer = async (cmd) => {
      if (cmd[0] === "tar") return zipAnswer()(cmd);
      if (cmd[1] === "install") ffmpeg = "/opt/homebrew/bin/ffmpeg";
      return ok("2099.01.01");
    };
    await ytdlpPlugin.install!(person());
    const during = await ytdlpPlugin.status!(person());
    expect(during).toMatchObject({ info: { ffmpeg: "installing", deno: "installing" } });
    expect(during.detail).toContain("Deno is being installed.");
    release();
    await Promise.all([ensureFfmpeg(), ensureDeno()]);
    const after = await ytdlpPlugin.status!(person());
    expect(after).toMatchObject({ info: { ffmpeg: "ready", deno: "ready" } });
    expect(after.detail).toBeUndefined();
  });
});

describe("progress lines", () => {
  test("the shapes yt-dlp really prints", () => {
    expect(
      progressOf("[download]  45.3% of ~  12.30MiB at    1.20MiB/s ETA 00:05 (frag 3/9)"),
    ).toEqual({
      percent: 45.3,
      speed: "1.20MiB/s",
      eta: "00:05",
    });
    expect(progressOf("[download]   0.2% of  614.43KiB at  Unknown B/s ETA Unknown")).toEqual({
      percent: 0.2,
      speed: undefined,
      eta: undefined,
    });
    expect(progressOf("[download] 100% of  614.43KiB in 00:00:01 at 400.00KiB/s")).toMatchObject({
      percent: 100,
      speed: "400.00KiB/s",
    });
    expect(progressOf("[download] Destination: /x/a.mp4")).toBeUndefined();
    expect(progressOf("/x/outputs/youtube/a.mp4")).toBeUndefined();
  });
});

describe("limits: none unless the person sets them", () => {
  test("empty settings are no limit; values are read; bad values are refused, never ignored", () => {
    expect(limitsOf({})).toEqual({ size: undefined, minutes: undefined });
    expect(limitsOf({ maxSize: " ", maxMinutes: "" })).toEqual({
      size: undefined,
      minutes: undefined,
    });
    expect(limitsOf({ maxSize: "500M", maxMinutes: "90" })).toEqual({ size: "500M", minutes: 90 });
    expect(limitsOf({ maxSize: "1.5g" }).size).toBe("1.5g");
    for (const bad of [
      { maxSize: "big" },
      { maxSize: "2 GB" },
      { maxMinutes: "0" },
      { maxMinutes: "1h" },
    ] as Record<string, string>[])
      expect(() => limitsOf(bad)).toThrow();
  });

  test("with no settings a download has no size limit and no deadline", async () => {
    ffmpeg = "/usr/bin/ffmpeg";
    answer = () => ok(`${join(dir, "code")}/x/outputs/youtube/a.mp4`);
    await tool("download").handler(person(), { url: VIDEO });
    const run = calls.find((c) => c.cmd.includes("--print"))!;
    expect(run.cmd).not.toContain("--max-filesize");
    expect(run.o.timeoutMs).toBeUndefined();
  });

  test("with settings the size goes to yt-dlp and the time becomes the deadline", async () => {
    ffmpeg = "/usr/bin/ffmpeg";
    answer = () => ok("/x/outputs/youtube/a.mp4");
    await tool("download").handler(person({ maxSize: "500M", maxMinutes: "2" }), { url: VIDEO });
    const run = calls.find((c) => c.cmd.includes("--print"))!;
    expect(
      run.cmd.slice(run.cmd.indexOf("--max-filesize"), run.cmd.indexOf("--max-filesize") + 2),
    ).toEqual(["--max-filesize", "500M"]);
    expect(run.o.timeoutMs).toBe(120_000);
  });

  test("a setting that is not valid stops the install and every call", async () => {
    const bad = person({ maxSize: "huge" });
    await expect(ytdlpPlugin.install!(bad)).rejects.toMatchObject({ code: "INVALID_FIELD" });
    await expect(tool("download").handler(bad, { url: VIDEO })).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
    expect(calls).toEqual([]);
  });

  test("a video over the limit is skipped by yt-dlp with a normal exit: the person is told it was the limit", async () => {
    ffmpeg = "/usr/bin/ffmpeg";
    answer = () =>
      ok("[download] File is larger than max-filesize (900000000 bytes > 1000 bytes). Aborting.");
    const e = await tool("download")
      .handler(person({ maxSize: "1K" }), { url: VIDEO })
      .catch((x) => x);
    expect(e.code).toBe("TOO_LARGE");
    expect(e.safe).toContain("1K");
  });
});

describe("addresses", () => {
  test.each([
    "http://127.0.0.1/x",
    "http://192.168.1.5/v",
    "http://localhost/v",
    "file:///etc/passwd",
    "--exec",
    "not a url",
  ])("%s is refused and nothing runs", async (url) => {
    await expect(tool("info").handler(person(), { url })).rejects.toMatchObject({
      code: expect.stringMatching(/BLOCKED_URL|INVALID_ARGS/),
    });
    expect(calls).toEqual([]);
  });

  test("the address goes after `--`, and user config is ignored", async () => {
    answer = () => ok(JSON.stringify({ title: "T" }));
    await tool("info").handler(person(), { url: VIDEO });
    const argv = calls[0]!.cmd;
    expect(argv.at(-2)).toBe("--");
    expect(argv.at(-1)).toBe(VIDEO);
    expect(argv).toContain("--ignore-config");
    expect(argv).toContain("--no-playlist");
  });
});

describe("tools", () => {
  test("info keeps only what a person needs", async () => {
    answer = () =>
      ok(
        JSON.stringify({
          title: "A talk",
          channel: "Someone",
          duration: 61,
          upload_date: "20260101",
          formats: [{ height: 360 }, { height: 1080 }, { height: 720 }, {}],
          description: "x".repeat(2000),
          secret: "never",
        }),
      );
    const out = (await tool("info").handler(person(), { url: VIDEO })) as Record<string, unknown>;
    expect(out).toMatchObject({ title: "A talk", seconds: 61, heights: [1080, 720, 360] });
    expect((out.description as string).length).toBe(600);
    expect(JSON.stringify(out)).not.toContain("never");
  });

  test("download without ffmpeg asks for one file with sound; with ffmpeg it joins the best parts", async () => {
    const c = person();
    answer = () => ok(join(dir, "code", c.userId, "outputs", "youtube", "Talk_[abc123].mp4"));
    const out = await tool("download").handler(c, { url: VIDEO, quality: "720p" });
    expect(calls[0]!.cmd).toContain("b[height<=720]/b");
    expect(calls[0]!.cmd).not.toContain("--merge-output-format");
    expect(out).toMatchObject({ saved: "outputs/youtube/Talk_[abc123].mp4", quality: "720p" });
    ffmpeg = "/usr/bin/ffmpeg";
    await tool("download").handler(person(), { url: VIDEO });
    expect(calls[1]!.cmd).toContain("bv*+ba/b");
    expect(calls[1]!.cmd).toContain("--merge-output-format");
  });

  test("a download tells the chat how far it is while the call runs, and stops when it returns", async () => {
    const lines: { text: string; percent?: number }[] = [];
    const c = { ...person(), progress: (p: { text: string; percent?: number }) => lines.push(p) };
    const saved = join(dir, "code", c.userId, "outputs", "youtube", "Talk_[abc123].mp4");
    answer = () =>
      ok(
        `[download]  10.0% of ~ 12.30MiB at 1.20MiB/s ETA 00:05\n[download]  45.3% of ~ 12.30MiB at 2.00MiB/s ETA 00:02\n${saved}`,
      );
    await tool("download").handler(c, { url: VIDEO });
    expect(lines.map((l) => l.text)).toEqual([
      "Starting",
      "Downloading video · 10% · 1.20MiB/s · ETA 00:05",
      "Downloading video · 45% · 2.00MiB/s · ETA 00:02",
    ]);
    // The plugin passes what yt-dlp printed; the chat rounds it (plugin-progress.ts).
    expect(lines.map((l) => l.percent)).toEqual([undefined, 10, 45.3]);
    // The audio of a video is named for what it is.
    ffmpeg = "/usr/bin/ffmpeg";
    lines.length = 0;
    await tool("audio").handler(c, { url: VIDEO });
    expect(lines.map((l) => l.text)).toContain("Downloading audio · 45% · 2.00MiB/s · ETA 00:02");
  });

  test("a poll with a chat watching waits for the job, shows it, then stops reporting", async () => {
    const lines: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    answer = async (_cmd, o) => {
      await gate;
      o.onLine?.("[download]  80.0% of 1MiB at 1MiB/s ETA 00:01");
      return ok("/x/outputs/youtube/a.mp4");
    };
    const c = person();
    const started = (await tool("download").handler(c, { url: VIDEO })) as {
      job: string;
      state: string;
    };
    expect(started.state).toBe("running");
    const watching = {
      ...c,
      progress: (p: { text: string }) => lines.push(p.text),
    } as PluginContext;
    const polled = (await tool("job").handler(watching, { job: started.job })) as { state: string };
    expect(polled.state).toBe("running");
    expect(lines[0]).toBe("Downloading video");
    const heard = lines.length;
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(lines.length).toBe(heard);
    // Without a chat watching, a poll answers at once and does not wait.
    const t0 = Date.now();
    await tool("job").handler(c, { job: started.job });
    expect(Date.now() - t0).toBeLessThan(100);
  });

  test("a quality or format that is not offered is refused", async () => {
    await expect(
      tool("download").handler(person(), { url: VIDEO, quality: "8k" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(
      tool("audio").handler(person(), { url: VIDEO, format: "wav; rm" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(calls).toEqual([]);
  });

  test("audio installs ffmpeg when it is missing, then converts", async () => {
    brew = "/opt/homebrew/bin/brew";
    setup({ platform: "darwin" });
    answer = (cmd) => {
      if (cmd[1] === "install") {
        ffmpeg = "/opt/homebrew/bin/ffmpeg";
        return ok();
      }
      return ok("/x/outputs/youtube/a.m4a");
    };
    await tool("audio").handler(person(), { url: VIDEO, format: "m4a" });
    expect(calls[0]!.cmd.slice(1)).toEqual(["install", "ffmpeg"]);
    expect(calls[1]!.cmd).toEqual(expect.arrayContaining(["-x", "--audio-format", "m4a"]));
  });

  test("audio says so when ffmpeg cannot be installed", async () => {
    setup({ platform: "darwin" });
    await expect(tool("audio").handler(person(), { url: VIDEO })).rejects.toMatchObject({
      code: "CLI_MISSING",
    });
  });

  test("what went wrong is told in words, never as raw output", async () => {
    const cases: [string, string][] = [
      ["ERROR: Sign in to confirm you're not a bot", "NEEDS_AUTH"],
      ["ERROR: Video unavailable", "NOT_FOUND"],
      ["ERROR: Unsupported URL: https://x", "INVALID_ARGS"],
      ["ERROR: HTTP Error 429: Too Many Requests", "RATE_LIMITED"],
      ["/srv/fixture-user/secret failed", "DOWNLOAD_ERROR"],
    ];
    for (const [stderr, code] of cases) {
      answer = () => ({ code: 1, stdout: "", stderr });
      const e = await tool("info")
        .handler(person(), { url: VIDEO })
        .catch((x) => x);
      expect(e.code).toBe(code);
      expect(String(e.safe)).not.toContain("/srv/fixture-user");
    }
  });

  test("update leaves the computer's own yt-dlp to its package manager", async () => {
    expect(await tool("update").handler(person(), {})).toMatchObject({ updated: false });
  });

  test("tools that save a file are writes; looking up is a read", () => {
    expect(ytdlpPlugin.tools!.map((t) => [t.name, t.effect])).toEqual([
      ["info", "read"],
      ["download", "write"],
      ["audio", "write"],
      ["job", "read"],
      ["cancel", "write"],
      ["update", "write"],
    ]);
    expect(ytdlpPlugin.icon).toBe("youtube");
  });
});

describe("long downloads run in the background", () => {
  test("a quick one answers with the path; a long one answers with a job id, progress and then the result", async () => {
    ffmpeg = "/usr/bin/ffmpeg";
    const c = person();
    let finish!: () => void;
    const held = new Promise<void>((r) => (finish = r));
    answer = async (_cmd, o) => {
      o.onLine?.("[download]  45.3% of 12.30MiB at 1.20MiB/s ETA 00:05");
      await held;
      return ok(join(dir, "code", c.userId, "outputs", "youtube", "Long.mp4"));
    };
    const started = (await tool("download").handler(c, { url: VIDEO })) as Record<string, unknown>;
    expect(started).toMatchObject({
      state: "running",
      percent: 45.3,
      speed: "1.20MiB/s",
      eta: "00:05",
    });
    const id = started.job as string;
    expect(await tool("job").handler(c, { job: id })).toMatchObject({ state: "running" });
    finish();
    while (((await tool("job").handler(c, { job: id })) as { state: string }).state === "running")
      await new Promise((r) => setTimeout(r, 5));
    const done = (await tool("job").handler(c, { job: id })) as Record<string, unknown>;
    expect(done).toMatchObject({ state: "done", saved: "outputs/youtube/Long.mp4", percent: 100 });
    // The job list names it too.
    expect(((await tool("job").handler(c, {})) as unknown[]).length).toBe(1);
  });

  test("a job can be stopped; another person cannot see or stop it", async () => {
    ffmpeg = "/usr/bin/ffmpeg";
    const c = person();
    answer = (_cmd, o) =>
      new Promise<Answer>((res) =>
        o.signal!.addEventListener("abort", () => res({ code: 1, stdout: "", stderr: "" })),
      );
    const started = (await tool("download").handler(c, { url: VIDEO })) as { job: string };
    await expect(tool("job").handler(person(), { job: started.job })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(tool("cancel").handler(person(), { job: started.job })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await tool("cancel").handler(c, { job: started.job })).toMatchObject({
      state: "cancelled",
    });
  });

  // Bots write in the person's files, so a link there must not decide where a download lands.
  test.skipIf(process.platform === "win32")(
    "a download is made apart and never written through a link in the files",
    async () => {
      const c = person();
      const out = join(dir, "code", c.userId, "outputs", "youtube");
      const outside = join(dir, "outside.mp4");
      await mkdir(out, { recursive: true });
      await symlink(outside, join(out, "Talk.mp4"));
      answer = async (_cmd, o) => {
        expect(o.cwd.startsWith(join(dir, "code"))).toBe(false);
        await writeFile(join(o.cwd, "Talk.mp4"), "video");
        return ok(join(o.cwd, "Talk.mp4"));
      };
      expect(await tool("download").handler(c, { url: VIDEO })).toMatchObject({
        saved: "outputs/youtube/Talk.mp4",
        bytes: 5,
      });
      expect(existsSync(outside)).toBe(false);
      expect(await readFile(join(out, "Talk.mp4"), "utf8")).toBe("video");
    },
  );

  test("three at a time per person", async () => {
    ffmpeg = "/usr/bin/ffmpeg";
    const c = person();
    answer = (_cmd, o) =>
      new Promise<Answer>((res) =>
        o.signal!.addEventListener("abort", () => res({ code: 1, stdout: "", stderr: "" })),
      );
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(((await tool("download").handler(c, { url: VIDEO })) as { job: string }).job);
    await expect(tool("download").handler(c, { url: VIDEO })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    for (const job of ids) await tool("cancel").handler(c, { job });
    answer = () => ok("/x/outputs/youtube/a.mp4");
    await expect(tool("download").handler(c, { url: VIDEO })).resolves.toMatchObject({
      saved: "outputs/youtube/a.mp4",
    });
  });
});

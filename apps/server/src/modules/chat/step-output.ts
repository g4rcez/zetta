import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { maskSecrets } from "./processes";

/**
 * Live output of the commands a Claude Code bot runs, so the chat can show what a step prints while it runs.
 *
 * Claude Code hands every shell command to `CLAUDE_CODE_SHELL_PREFIX` as one argument. The wrapper below runs it as usual and copies
 * stdout and stderr into a file of a per-run folder. The chat reads that file while the command runs and the file is deleted with the
 * folder when the run ends: the output is never stored. A step is found by its command text, because the CLI sets no id for the shell.
 */

export const LIVE_SHELL = "zetta-shell.sh";
const LIVE_TEE = "zetta-tee.bash";
export const CONTAINER_LIVE_DIR = "/zetta-live";
/** Per stream and per command: a program that prints gigabytes must not fill the disk. */
export const LIVE_FILE_CAP = 1_048_576;
/** The first read of a long output starts this far from its end. */
const FIRST_READ = 65_536;
const READ_MAX = 65_536;

/**
 * Entry point: runs the shell command as the CLI would. Only a Bash-tool command (it ends by recording the cwd with `pwd -P >|`) is
 * copied; hooks and MCP servers come through the same prefix and run untouched. The shell is the one the CLI picks: bash or zsh.
 */
export const SHELL_SCRIPT = `#!/bin/sh
case "\${SHELL##*/}" in bash|zsh) sh="$SHELL" ;; *) sh=$(command -v bash || command -v zsh || echo /bin/sh) ;; esac
case "$1" in *'pwd -P >|'*) ;; *) exec "$sh" -c "$1" ;; esac
[ -n "$ZETTA_LIVE_DIR" ] && command -v bash >/dev/null 2>&1 || exec "$sh" -c "$1"
ZETTA_SHELL="$sh" exec bash "$ZETTA_LIVE_DIR/${LIVE_TEE}" "$1"
`;

/**
 * Runs the command, keeps its exit status and its two streams apart, and copies both into a file as they print. Each copy is written by
 * a `tee` that cannot grow its file past the cap (`ulimit -f`, in KiB); when it stops, a `cat` keeps draining so the command never blocks.
 */
export const TEE_SCRIPT = `#!/bin/bash
id="$$-$RANDOM"
dir="$ZETTA_LIVE_DIR"
printf '%s' "$1" > "$dir/$id.cmd.tmp" && mv "$dir/$id.cmd.tmp" "$dir/$id.cmd"
sink() { trap '' XFSZ; ulimit -f ${LIVE_FILE_CAP / 1024} 2>/dev/null; tee -a "$dir/$id.out" >/dev/null 2>&1; cat >/dev/null; }
"$ZETTA_SHELL" -c "$1" \\
  > >(tee >(sink)) \\
  2> >(tee >(sink) >&2)
code=$?
wait
exit $code
`;

/** A fresh private folder with the two scripts. `root` should sit where a container runtime can mount it. */
export async function createLiveDir(root: string): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(root, "live-"));
  await chmod(dir, 0o700).catch(() => {});
  await writeFile(join(dir, LIVE_SHELL), SHELL_SCRIPT, { mode: 0o700 });
  await writeFile(join(dir, LIVE_TEE), TEE_SCRIPT, { mode: 0o700 });
  return dir;
}

export type LiveStep = {
  id: string;
  command: string;
  done: boolean;
  /** The output file once a command was matched to this step. */
  file?: string | undefined;
};

export type LiveRun = {
  readonly dir: string;
  readonly secrets: readonly string[];
  closed: boolean;
  steps: Map<string, LiveStep>;
  claimed: Set<string>;
};

const runs = new WeakMap<AbortSignal, Set<LiveRun>>();

/** Registers the live folder of a CLI run under the abort signal of its turn (the same key `trackRun` uses). */
export function openLiveRun(
  signal: AbortSignal | undefined,
  dir: string,
  secrets: readonly string[],
): LiveRun {
  const run: LiveRun = { dir, secrets, closed: false, steps: new Map(), claimed: new Set() };
  if (signal) {
    const set = runs.get(signal) ?? new Set<LiveRun>();
    set.add(run);
    runs.set(signal, set);
  }
  return run;
}

const denied = new WeakSet<AbortSignal>();
/** A turn whose output only its bot's owner may read (the person chatting is someone else): nothing of it is served, ever. */
export const denyLiveOutput = (signal: AbortSignal) => {
  denied.add(signal);
};

/** The run ended: followers finish what is left and stop. Call before the folder is removed. */
export const closeLiveRun = (run: LiveRun) => {
  run.closed = true;
};

export const beginStep = (run: LiveRun, id: string, command: string) => {
  run.steps.set(id, { id, command, done: false });
};

/** The command finished: its file is matched first (it exists by now), then the step is marked done. */
export async function endStep(run: LiveRun, id: string) {
  await syncRun(run).catch(() => {});
  const step = run.steps.get(id);
  if (step) step.done = true;
}

/** The step of a turn, with its run. */
export function findStep(
  signal: AbortSignal,
  id: string,
): { run: LiveRun; step: LiveStep } | undefined {
  if (denied.has(signal)) return undefined;
  for (const run of runs.get(signal) ?? []) {
    const step = run.steps.get(id);
    if (step) return { run, step };
  }
  return undefined;
}

/**
 * When a command of the turn last printed (ms since epoch), or undefined when nothing was recorded. The wrapper appends to a `.out`
 * file as the command prints, so its mtime is the last sign of life of a long command; the `.cmd` file marks when one started.
 * Past `LIVE_FILE_CAP` a stream stops being copied, so a command that prints for a very long time looks silent after that.
 */
export async function lastOutputAt(signal: AbortSignal): Promise<number | undefined> {
  let newest: number | undefined;
  for (const run of runs.get(signal) ?? []) {
    if (run.closed) continue;
    const names = (await readdir(run.dir).catch(() => [] as string[])).filter(
      (n) => n.endsWith(".out") || n.endsWith(".cmd"),
    );
    for (const name of names) {
      const info = await stat(join(run.dir, name)).catch(() => undefined);
      if (info && (newest === undefined || info.mtimeMs > newest)) newest = info.mtimeMs;
    }
  }
  return newest;
}

/** Quotes, backslashes and whitespace differ between the tool's command and the shell string that embeds it. */
const plain = (s: string) => s.replace(/['"\\\s]/g, "");

/**
 * Matches the commands the wrapper recorded to the steps that have none. A command goes to the step whose text it contains. What is left
 * pairs by order (the CLI runs one tool at a time, so this is the common case when the quoting hides the match).
 */
export async function syncRun(run: LiveRun) {
  const names = (await readdir(run.dir).catch(() => [] as string[])).filter(
    (n) => n.endsWith(".cmd") && !run.claimed.has(n),
  );
  const open = [...run.steps.values()].filter((s) => !s.file);
  if (!names.length || !open.length) return;
  const found: { name: string; text: string; at: number }[] = [];
  for (const name of names) {
    const path = join(run.dir, name);
    const [text, info] = await Promise.all([
      readFile(path, "utf8").catch(() => undefined),
      stat(path).catch(() => undefined),
    ]);
    if (text !== undefined && info) found.push({ name, text: plain(text), at: info.mtimeMs });
  }
  found.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
  const link = (step: LiveStep, i: number) => {
    const [hit] = found.splice(i, 1);
    run.claimed.add(hit!.name);
    step.file = join(run.dir, hit!.name.replace(/\.cmd$/, ".out"));
  };
  const rest: LiveStep[] = [];
  for (const step of open) {
    const needle = plain(step.command);
    const at = needle ? found.findIndex((f) => f.text.includes(needle)) : -1;
    if (at >= 0) link(step, at);
    else rest.push(step);
  }
  for (const step of rest) if (found.length) link(step, 0);
}

/** Removes ANSI escapes (colors, cursor moves, hyperlinks) and other control characters except tab, newline and carriage return. */
export const stripAnsi = (text: string) =>
  text
    // oxlint-disable-next-line no-control-regex
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    // oxlint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

/** Known tokens by shape, then the exact secret values this run was given. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = maskSecrets(stripAnsi(text));
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join("[redacted]");
  return out;
}

/** The values of a run's environment that look like credentials, for `scrub`. Short values (flags, locales) would mask ordinary words. */
export const secretValues = (env: Record<string, string> | undefined): string[] =>
  Object.values(env ?? {}).filter((v) => v.length >= 8);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

async function readFrom(file: string, from: number, max: number) {
  const handle = await open(file, "r").catch(() => undefined);
  if (!handle) return undefined;
  try {
    const { size } = await handle.stat();
    if (size <= from) return { bytes: Buffer.alloc(0), size };
    const bytes = Buffer.alloc(Math.min(max, size - from));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, from);
    return { bytes: bytes.subarray(0, bytesRead), size };
  } finally {
    await handle.close();
  }
}

/**
 * The text a step prints, as it arrives: first the last 64 KB written so far, then each new piece, until the command is done and the file
 * is read to its end (or the run closes, or `signal` aborts). Complete lines go out at once; a partial line waits for its end, for the
 * step to finish or for `idleMs` of silence, so a secret split across two reads is still masked.
 */
export async function* followStep(
  run: LiveRun,
  step: LiveStep,
  signal?: AbortSignal,
  opts: { pollMs?: number; idleMs?: number } = {},
): AsyncGenerator<string, void> {
  const pollMs = opts.pollMs ?? 250;
  const idleMs = opts.idleMs ?? 2000;
  const decoder = new TextDecoder();
  let offset = 0,
    first = true,
    pending = "",
    pendingSince = 0;
  const flush = (all: boolean) => {
    const cut = all ? pending.length : pending.lastIndexOf("\n") + 1;
    if (cut <= 0) return "";
    const text = scrub(pending.slice(0, cut), run.secrets);
    pending = pending.slice(cut);
    return text;
  };
  while (!signal?.aborted) {
    await syncRun(run).catch(() => {});
    const finished = step.done || run.closed;
    let grew = false;
    if (step.file) {
      const got = await readFrom(step.file, offset, first ? Number.MAX_SAFE_INTEGER : READ_MAX);
      if (got) {
        if (first && got.size > FIRST_READ) {
          // Start near the end; the missing top is said once.
          offset = got.size - FIRST_READ;
          const tail = await readFrom(step.file, offset, FIRST_READ);
          if (tail) {
            yield "[earlier output not shown]\n";
            offset += tail.bytes.length;
            pending += decoder.decode(tail.bytes, { stream: true });
            grew = tail.bytes.length > 0;
          }
        } else {
          offset += got.bytes.length;
          pending += decoder.decode(got.bytes, { stream: true });
          grew = got.bytes.length > 0;
        }
        first = false;
      }
    }
    if (grew) pendingSince = Date.now();
    const lines = flush(false);
    if (lines) yield lines;
    if (pending && (finished || Date.now() - pendingSince >= idleMs)) {
      // A finished step may still have a piece being written: one more read happens below before this ends.
      if (finished && grew) continue;
      const rest = flush(true);
      if (rest) yield rest;
    }
    if (finished && !grew) {
      pending += decoder.decode();
      const rest = flush(true);
      if (rest) yield rest;
      return;
    }
    await sleep(pollMs, signal);
  }
}

/** Removes a run's folder. Output lives only as long as the run. */
export const removeLiveDir = (dir: string) => rm(dir, { recursive: true, force: true });

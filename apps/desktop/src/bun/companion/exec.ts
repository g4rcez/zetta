import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type ExecResult = { exitCode: number; output: string; truncated: boolean };

const MAX_OUTPUT = 64 * 1024;
const RUN_TIMEOUT_MS = 120_000;

export type Spawn = (
  command: string[],
  options: { cwd: string; env: Record<string, string>; signal: AbortSignal },
) => {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
};

const bunSpawn: Spawn = (command, { cwd, env, signal }) => {
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  return {
    stdout: child.stdout as ReadableStream<Uint8Array>,
    stderr: child.stderr as ReadableStream<Uint8Array>,
    exited: child.exited,
    kill: () => child.kill(),
  };
};

/** The shell a command line runs in. */
export const shellFor = (platform: NodeJS.Platform = process.platform): string[] =>
  platform === "win32" ? ["cmd.exe", "/d", "/s", "/c"] : ["/bin/sh", "-c"];

/** The environment a command gets: enough to find tools, not the app's own. */
function commandEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TERM",
    "USERPROFILE",
    "SystemRoot",
    "COMSPEC",
  ])
    if (base[key]) env[key] = base[key]!;
  return env;
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  room: () => number,
  add: (text: string) => void,
) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const left = room();
    if (left > 0)
      add(decoder.decode(value.length > left ? value.subarray(0, left) : value, { stream: true }));
  }
}

/** Runs a command line in the person's home folder with the stdout and stderr together, a time limit and a size cap. */
export async function runCommand(
  command: string,
  options: {
    spawn?: Spawn;
    platform?: NodeJS.Platform;
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
  } = {},
): Promise<ExecResult> {
  const {
    spawn = bunSpawn,
    platform = process.platform,
    cwd = homedir(),
    timeoutMs = RUN_TIMEOUT_MS,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let output = "";
  let truncated = false;
  const add = (text: string) => (output += text);
  const room = () => {
    const left = MAX_OUTPUT - output.length;
    if (left <= 0) truncated = true;
    return left;
  };
  try {
    const child = spawn([...shellFor(platform), command], {
      cwd,
      env: commandEnv(options.env ?? process.env),
      signal: controller.signal,
    });
    const [code] = await Promise.all([
      child.exited,
      readCapped(child.stdout, room, add),
      readCapped(child.stderr, room, add),
    ]);
    if (controller.signal.aborted)
      return {
        exitCode: 124,
        output: `${output}\n[stopped after ${Math.round(timeoutMs / 1000)}s]`.slice(0, MAX_OUTPUT),
        truncated,
      };
    return { exitCode: code ?? 1, output, truncated };
  } catch (error) {
    if (controller.signal.aborted)
      return {
        exitCode: 124,
        output: `${output}\n[stopped after ${Math.round(timeoutMs / 1000)}s]`.slice(0, MAX_OUTPUT),
        truncated,
      };
    return {
      exitCode: 127,
      output: `could not run: ${(error as Error).message}`.slice(0, 500),
      truncated: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** A folder's entries, one per line: `d name` for a folder, `- name size` for a file. A relative path is taken from the home folder. */
export async function listFolder(path: string, home = homedir()): Promise<ExecResult> {
  const target = isAbsolute(path) ? path : resolve(join(home, path));
  try {
    const names = (await readdir(target)).sort().slice(0, 500);
    const lines: string[] = [];
    for (const name of names) {
      const info = await stat(join(target, name)).catch(() => null);
      lines.push(info?.isDirectory() ? `d ${name}` : `- ${name}${info ? ` ${info.size}` : ""}`);
    }
    return { exitCode: 0, output: lines.join("\n"), truncated: names.length === 500 };
  } catch (error) {
    return {
      exitCode: 1,
      output: `could not list: ${(error as { code?: string }).code ?? "error"}`,
      truncated: false,
    };
  }
}

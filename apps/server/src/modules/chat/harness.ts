import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { containerUser } from "../container-user";
import { join } from "node:path";

export type NativeHarness = "pi" | "codex" | "omp" | "claude-code" | "opencode" | "cursor";

/**
 * Code access for a run. "git" = host run: only what the CLI can enforce (git and file tools); "full" = the run is inside a hardened
 * container, which is the boundary, so the CLI may run any command. Without it, non-interactive CLIs auto-deny every command that
 * would need approval (git clone included), which is why bots could not touch code.
 */
export type CodeMode = "git" | "full";
const CLAUDE_FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];
// History rewrites are never pre-approved; a person has to ask for them explicitly.
const CLAUDE_DENIED = ["Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(git config --global:*)", "Bash(git config --system:*)"];

/** Non-interactive invocation per installed CLI. The prompt is always one argv element (no shell) and always last. */
export const harnessCommands: Record<NativeHarness, (prompt: string, model: string | null, code?: CodeMode) => string[]> = {
  // `--flag=value` keeps the variadic tool lists from swallowing the prompt.
  "claude-code": (p, m, c) => ["claude", "-p", ...(m ? ["--model", m] : []), ...(c ? ["--permission-mode", "acceptEdits", `--allowedTools=${[...CLAUDE_FILE_TOOLS, c === "full" ? "Bash" : "Bash(git:*)"].join(",")}`, `--disallowedTools=${CLAUDE_DENIED.join(",")}`] : []), p],
  codex: (p, m, c) => ["codex", "exec", "--skip-git-repo-check", ...(c === "full" ? ["--dangerously-bypass-approvals-and-sandbox"] : c ? ["--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true"] : []), ...(m ? ["--model", m] : []), p],
  pi: (p, m) => ["pi", "-p", ...(m ? ["--model", m] : []), p],
  omp: (p, m) => ["omp", "-p", ...(m ? ["--model", m] : []), p],
  opencode: (p, m, c) => ["opencode", "run", ...(c ? ["--auto"] : []), ...(m ? ["--model", m] : []), p],
  cursor: (p, m, c) => ["cursor-agent", "-p", ...(c ? ["--force"] : []), ...(m ? ["--model", m] : []), p],
};

/** Where code workspaces live. One folder per user, shared by that user's bots, so cloned repositories survive between turns. */
export function codeWorkspace(userId: string, root = process.env.ZETTA_CODE_ROOT || join(homedir(), ".zetta", "code")) {
  return join(root, userId.replace(/[^A-Za-z0-9_-]/g, "_"));
}
/**
 * Git identity and credentials for a code run, as environment variables (values never reach argv). A GitHub token the user bound to
 * the bot is offered to github.com only, through a credential helper that reads it from the environment; it is never written to disk.
 */
export function gitEnv(author: string, extra: Record<string, string> = {}): Record<string, string> {
  const name = author.replace(/[\r\n<>]/g, " ").trim().slice(0, 80) || "Zetta bot", email = "bot@zetta.invalid";
  const env: Record<string, string> = { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email, GIT_TERMINAL_PROMPT: "0" };
  if (extra.GITHUB_TOKEN) Object.assign(env, { GH_TOKEN: extra.GITHUB_TOKEN, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.https://github.com.helper", GIT_CONFIG_VALUE_0: '!f() { test "$1" = get && echo username=x-access-token && echo "password=$GITHUB_TOKEN"; }; f' });
  return env;
}

/** Only what CLIs need to find their own login (keychain on macOS needs USER/LOGNAME); no app secrets or DB URLs. */
const passed = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SHELL", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
  // Windows equivalents: CLIs find their login under the profile directories and need the system root to start at all.
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "SystemRoot", "SYSTEMROOT", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERNAME"] as const;
/**
 * With ZETTA_HARNESS_HOME_ROOT set, every (user, harness) gets its own HOME/XDG directories, so one user's CLI login, sessions
 * and config are never visible to another user's runs. Without it all users share the server OS user's login (documented limit).
 */
export function harnessHome(userId: string | undefined, harness: NativeHarness, root = process.env.ZETTA_HARNESS_HOME_ROOT) {
  if (!root || !userId) return undefined;
  return join(root, userId.replace(/[^A-Za-z0-9_-]/g, "_"), harness);
}
function passEnv(home?: string, extra?: Record<string, string>) {
  const env: Record<string, string> = { LANG: "C.UTF-8" };
  for (const k of passed) if (process.env[k]) env[k] = process.env[k]!;
  if (home) {
    env.HOME = home; env.XDG_CONFIG_HOME = join(home, ".config"); env.XDG_DATA_HOME = join(home, ".local/share"); env.XDG_CACHE_HOME = join(home, ".cache");
    if (process.platform === "win32") { env.USERPROFILE = home; env.APPDATA = join(home, "AppData", "Roaming"); env.LOCALAPPDATA = join(home, "AppData", "Local"); }
  }
  // Per-run provider keys resolved for the requesting user only; never taken from the server's own environment.
  if (extra) Object.assign(env, extra);
  return env;
}

export type HarnessErrorCode = "not_installed" | "auth_required" | "timeout" | "failed" | "busy" | "cancelled" | "quota";
export type DockerConfig = { image: string; network: string; memory: string; cpus: string; pids: number; bin: string };
/** `ZETTA_HARNESS_RUNTIME=docker` runs every harness turn in a throwaway, hardened container instead of on the host. */
export function dockerConfig(env: NodeJS.ProcessEnv = process.env): DockerConfig | undefined {
  if (env.ZETTA_HARNESS_RUNTIME !== "docker") return undefined;
  return { image: env.ZETTA_HARNESS_IMAGE ?? "zetta-harness:latest", network: env.ZETTA_HARNESS_NETWORK ?? "bridge", memory: env.ZETTA_HARNESS_MEMORY ?? "1g", cpus: env.ZETTA_HARNESS_CPUS ?? "1", pids: Number(env.ZETTA_HARNESS_PIDS ?? 256), bin: env.ZETTA_DOCKER_BIN ?? "docker" };
}

/**
 * Pure builder for the container command. Hardening: no extra capabilities, no privilege escalation, read-only root filesystem,
 * tmpfs for /tmp and the working directory, non-root user, memory/cpu/pid limits, no host mounts except this user's own harness
 * home (login state) and, for code runs, this user's own code workspace as the working directory, and only the explicitly passed environment variables (never inherited from the server).
 */
export function dockerArgs(cfg: DockerConfig, o: { name: string; argv: string[]; home?: string; workspace?: string | undefined; env: Record<string, string> }) {
  const args = ["run", "--rm", "--name", o.name, "--network", cfg.network, "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit", String(cfg.pids), "--memory", cfg.memory, "--cpus", cfg.cpus,
    "--user", containerUser().user, "--entrypoint", "", "--tmpfs", "/tmp:rw,size=64m", ...(o.workspace ? ["-v", `${o.workspace}:/work:rw`] : ["--tmpfs", `/work:rw,size=64m,uid=${containerUser().uid}`]), "-w", "/work", "-e", "HOME=/home/agent", "-e", "LANG=C.UTF-8"];
  if (o.home) args.push("-v", `${o.home}:/home/agent:rw`); else args.push("--tmpfs", `/home/agent:rw,size=64m,uid=${containerUser().uid}`);
  // Values never appear in argv (visible to every local user via `ps`): `-e KEY` makes docker read them from its own environment.
  for (const k of Object.keys(o.env)) if (/^[A-Z][A-Z0-9_]*$/.test(k)) args.push("-e", k);
  return [...args, cfg.image, ...o.argv];
}

export class HarnessError extends Error {
  constructor(readonly code: HarnessErrorCode) { super(code); }
}
/** Actionable text for each failure; never includes paths, stderr or credentials. */
export function harnessMessage(harness: string, code: HarnessErrorCode) {
  switch (code) {
    case "not_installed": return `${harness} is not installed on this server. Ask the administrator to install it.`;
    case "auth_required": return `${harness} is not signed in for you. Sign in to ${harness} on the server, then try again.`;
    case "timeout": return `${harness} took too long and was stopped. Try a shorter request.`;
    case "quota": return `${harness} has reached its usage limit for the signed-in account. Wait for the limit to reset or switch to an API key.`;
    case "busy": return "The server is busy running other bots. Try again in a moment.";
    case "cancelled": return "The run was cancelled.";
    default: return `${harness} could not answer. Try again.`;
  }
}
const QUOTA_PATTERN = /usage limit|rate limit|quota|usage_limit_reached|credits/i;
const AUTH_PATTERN = /not logged in|please (run )?\/?login|log in|sign in|unauthori[sz]ed|authentication|api key|credential|401/i;

export type CliInput = { harness: NativeHarness; prompt: string; model: string | null; userId?: string; /** Run in the user's persistent code workspace with git and file permissions pre-approved. `author` signs commits. */ code?: { author: string }; extraEnv?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number; resolve?: (name: string) => string | null };
export type RunCli = (input: CliInput) => Promise<string>;
export type StreamCli = (input: CliInput) => AsyncGenerator<string, void>;
const OUTPUT_CAP = 65_000;

/** Bounded concurrency: a global cap and a per-user cap. Waiters beyond `waitMs` get a typed "busy" error. */
export function createLimiter({ global = 4, perUser = 2, waitMs = 15_000 } = {}) {
  let active = 0; const byUser = new Map<string, number>(); const waiters: (() => void)[] = [];
  const free = (u: string) => active < global && (byUser.get(u) ?? 0) < perUser;
  return {
    async acquire(user: string, signal?: AbortSignal): Promise<() => void> {
      const deadline = Date.now() + waitMs;
      while (!free(user)) {
        if (signal?.aborted) throw new HarnessError("cancelled");
        if (Date.now() >= deadline) throw new HarnessError("busy");
        await new Promise<void>((res) => { const t = setTimeout(res, 100); waiters.push(() => { clearTimeout(t); res(); }); });
      }
      active++; byUser.set(user, (byUser.get(user) ?? 0) + 1);
      let released = false;
      return () => { if (released) return; released = true; active--; byUser.set(user, (byUser.get(user) ?? 1) - 1); waiters.shift()?.(); };
    },
    stats: () => ({ active }),
  };
}
export const defaultLimiter = createLimiter({ global: Number(process.env.ZETTA_HARNESS_MAX ?? 4), perUser: Number(process.env.ZETTA_HARNESS_MAX_PER_USER ?? 2) });

/** Kills the whole process tree: a process group on POSIX, `taskkill /T` on Windows (there are no negative pids there). */
export function killGroup(pid: number, platform: string = process.platform) {
  if (platform === "win32") { try { Bun.spawn(["taskkill", "/pid", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }); } catch { /* already gone */ } return; }
  try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
}

/** Streams the harness's stdout as it arrives. Runs in a throwaway empty cwd (or, with `code`, the user's persistent workspace) with a minimal environment, in its own process group
 * (the whole tree is killed on timeout, cancel, overflow or generator close), bounded by a deadline, output cap and concurrency limits. */
export const streamCli: StreamCli = async function* ({ harness, prompt, model, userId, extraEnv: baseEnv, signal, timeoutMs, resolve = Bun.which, code }) {
  const docker = dockerConfig();
  const workspace = code && userId ? codeWorkspace(userId) : undefined;
  const argv = harnessCommands[harness](prompt, model, workspace ? (docker ? "full" : "git") : undefined);
  const extraEnv = workspace ? { ...baseEnv, ...gitEnv(code!.author, baseEnv) } : baseEnv;
  // Cloning and building take longer than a chat answer.
  if (timeoutMs === undefined) timeoutMs = workspace ? Number(process.env.ZETTA_CODE_TIMEOUT_MS ?? 600_000) : 120_000;
  const exe = docker ? docker.bin : resolve(argv[0]!);
  if (!exe) throw new HarnessError("not_installed");
  const release = await defaultLimiter.acquire(userId ?? "anonymous", signal);
  const home = harnessHome(userId, harness);
  const containerName = docker ? `zetta-run-${crypto.randomUUID()}` : undefined;
  const kill = (pid: number) => { killGroup(pid); if (docker && containerName) { try { Bun.spawn([docker.bin, "kill", containerName], { stdout: "ignore", stderr: "ignore" }); } catch { /* best effort */ } } };
  let cwd: string | undefined;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (home) { await mkdir(home, { recursive: true, mode: 0o700 }); await chmod(home, 0o700).catch(() => {}); }
    if (workspace) { await mkdir(workspace, { recursive: true, mode: 0o700 }); await chmod(workspace, 0o700).catch(() => {}); cwd = workspace; }
    else cwd = await mkdtemp(join(tmpdir(), "zetta-run-"));
    child = docker
      ? Bun.spawn([exe, ...dockerArgs(docker, { name: containerName!, argv, home, workspace, env: extraEnv ?? {} })], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}), ...Object.fromEntries(Object.entries(extraEnv ?? {}).filter(([k]) => /^[A-Z][A-Z0-9_]*$/.test(k))) }, detached: true } as never)
      : Bun.spawn([exe, ...argv.slice(1)], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: passEnv(home, extraEnv), detached: true } as never);
    const proc = child;
    let timedOut = false, cancelled = false, onStop!: (e: HarnessError) => void;
    const stop = new Promise<never>((_, reject) => { onStop = reject; });
    stop.catch(() => {});
    timer = setTimeout(() => { timedOut = true; kill(proc.pid); onStop(new HarnessError("timeout")); }, timeoutMs);
    const onAbort = () => { cancelled = true; kill(proc.pid); onStop(new HarnessError("cancelled")); };
    if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
    // stderr is only classified (bounded), never surfaced.
    let errText = "";
    const errDone = (async () => { const r = (proc.stderr as ReadableStream<Uint8Array>).getReader(), d = new TextDecoder(); try { for (;;) { const { done, value } = await r.read(); if (done) break; if (errText.length < 4000) errText += d.decode(value, { stream: true }); } } catch { /* ignore */ } })();
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader(), decoder = new TextDecoder();
    let total = 0;
    try {
      for (;;) {
        // The stop signal also frees us when a grandchild keeps stdout open after the harness is killed.
        const { done, value } = await Promise.race([reader.read(), stop]);
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        total += text.length;
        if (total > OUTPUT_CAP) { kill(proc.pid); break; }
        if (text) yield text;
      }
      const code = await Promise.race([proc.exited, stop]);
      await Promise.race([errDone, Bun.sleep(200)]);
      if (docker && (code === 127 || code === 126 || /executable file not found|no such file or directory.*(claude|codex|pi|omp|opencode|cursor)/i.test(errText))) throw new HarnessError("not_installed");
      if ((code !== 0 && total <= OUTPUT_CAP) || total === 0) throw new HarnessError(timedOut ? "timeout" : cancelled ? "cancelled" : QUOTA_PATTERN.test(errText) ? "quota" : AUTH_PATTERN.test(errText) ? "auth_required" : "failed");
    } finally { signal?.removeEventListener("abort", onAbort); reader.cancel().catch(() => {}); }
  } finally {
    if (timer) clearTimeout(timer);
    if (child) kill(child.pid);
    // A code workspace is the user's persistent checkout; only throwaway directories are removed.
    if (cwd && cwd !== workspace) await rm(cwd, { recursive: true, force: true });
    release();
  }
};

export const runCli: RunCli = async (input) => {
  let text = "";
  for await (const chunk of streamCli(input)) text += chunk;
  return text.trim().slice(0, OUTPUT_CAP);
};

/** Installed/version info for the readiness view. Paths are never returned. */
const versionCache = new Map<string, { at: number; value: { installed: boolean; version: string | null } }>();
export async function inspectHarness(harness: NativeHarness, resolve: (n: string) => string | null = Bun.which) {
  const exe = harnessCommands[harness]("x", null)[0]!;
  const hit = versionCache.get(harness);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const docker = dockerConfig();
  if (docker) {
    let v = { installed: false, version: null as string | null };
    try {
      const p = Bun.spawn([docker.bin, "run", "--rm", "--network", "none", "--user", containerUser().user, docker.image, exe, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
      const t = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 20_000);
      const out = await new Response(p.stdout as ReadableStream).text(); const code = await p.exited; clearTimeout(t);
      if (code === 0 && out.trim()) v = { installed: true, version: out.trim().split("\n")[0]!.slice(0, 60) };
    } catch { /* not available */ }
    versionCache.set(harness, { at: Date.now(), value: v }); return v;
  }
  const path = resolve(exe);
  let value = { installed: false, version: null as string | null };
  if (path) {
    value = { installed: true, version: null };
    try {
      const p = Bun.spawn([path, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: passEnv(), detached: true } as never);
      const t = setTimeout(() => killGroup(p.pid), 5000);
      const out = await new Response(p.stdout as ReadableStream).text(); clearTimeout(t);
      value.version = out.trim().split("\n")[0]?.slice(0, 60) || null;
    } catch { /* version stays unknown */ }
  }
  versionCache.set(harness, { at: Date.now(), value });
  return value;
}

/** Boot-time cleanup of harness containers left by a previous server process (single-instance assumption: see docs/operations/recovery.md). */
export async function sweepHarnessContainers() {
  const docker = dockerConfig();
  if (!docker) return 0;
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  try {
    const p = Bun.spawn([docker.bin, "ps", "-q", "--filter", "name=zetta-run-"], { stdout: "pipe", stderr: "ignore", env });
    const ids = (await new Response(p.stdout as ReadableStream).text()).split(/\s+/).filter((x) => /^[0-9a-f]{6,64}$/.test(x));
    for (const id of ids) Bun.spawn([docker.bin, "kill", id], { stdout: "ignore", stderr: "ignore", env });
    return ids.length;
  } catch { return 0; }
}

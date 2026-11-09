/**
 * The CLI processes of running chat turns, for the "taking a long time" card. A bot's CLI (Claude Code, Codex...) runs commands inside
 * itself that Zetta never sees; the process tree is the only place where they show. A run is tracked by the turn's abort signal, which
 * reaches `streamCli` unchanged, so the turn can find its own processes without a global lookup by pid.
 */
export type RunningCli = {
  botId?: string | undefined;
  harness: string;
  pid: number;
  /** Docker/Podman runs: the container name (`docker top` lists its processes). */
  container?: string | undefined;
  startedAt: number;
};
export type ProcessInfo = {
  pid: number;
  /** The command line, with secrets masked and cut short. */
  command: string;
  /** Seconds the process has run; unknown for container processes. */
  runningFor?: number | undefined;
};

const runs = new WeakMap<AbortSignal, Set<RunningCli>>();

/** Remembers a CLI run of the turn that owns `signal`. Returns the function that forgets it. */
export function trackRun(signal: AbortSignal | undefined, run: RunningCli): () => void {
  if (!signal) return () => {};
  const set = runs.get(signal) ?? new Set<RunningCli>();
  set.add(run);
  runs.set(signal, set);
  return () => {
    set.delete(run);
  };
}
export const runsOf = (signal: AbortSignal): RunningCli[] => [...(runs.get(signal) ?? [])];

const COMMAND_MAX = 200;
const PROCESSES_MAX = 10;

/** Masks what text can carry that must not reach a screen: env assignments, flags, bearer tokens, keys, URL passwords. Keeps layout. */
export function maskSecrets(command: string): string {
  // A value is a quoted string or a run of non-space characters; a bare token stops before a closing quote.
  const value = String.raw`(?:"[^"]*"|'[^']*'|\S+)`;
  const bare = String.raw`[^\s"']+`;
  return command
    .replace(
      new RegExp(
        String.raw`\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH)[A-Za-z0-9_]*)=${value}`,
        "gi",
      ),
      "$1=[redacted]",
    )
    .replace(
      new RegExp(
        String.raw`(--?(?:token|password|passwd|secret|api-key|apikey|auth|authorization|key)(?:=|\s+))${value}`,
        "gi",
      ),
      "$1[redacted]",
    )
    .replace(
      new RegExp(String.raw`\b(Authorization:\s*)(?:(?:Bearer|Basic)\s+)?${bare}`, "gi"),
      "$1[redacted]",
    )
    .replace(new RegExp(String.raw`\bBearer\s+${bare}`, "gi"), "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{8,}/g, "[redacted]")
    .replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, "://[redacted]@");
}

/** A command line for the slow-turn card: masked, trimmed and cut short. */
export const redactCommand = (command: string): string =>
  maskSecrets(command).trim().slice(0, COMMAND_MAX);

/** `ps` elapsed time `[[dd-]hh:]mm:ss` in seconds; undefined when it does not match. */
export function parseEtime(etime: string): number | undefined {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!m) return undefined;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s);
}

export type PsRow = { pid: number; ppid: number; runningFor?: number | undefined; command: string };
/** Parses `ps -A -o pid=,ppid=,etime=,command=`. */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m)
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        runningFor: parseEtime(m[3]!),
        command: m[4]!,
      });
  }
  return rows;
}

/** The processes below `root`, parents before children (breadth first). The root itself is not part of the result. */
export function descendants(rows: readonly PsRow[], root: number): PsRow[] {
  const found: PsRow[] = [];
  const seen = new Set([root]);
  let level = [root];
  while (level.length) {
    const next: number[] = [];
    for (const row of rows)
      if (level.includes(row.ppid) && !seen.has(row.pid)) {
        seen.add(row.pid);
        found.push(row);
        next.push(row.pid);
      }
    level = next;
  }
  return found;
}

/** Parses `docker top`: a header line, then rows whose first columns are fixed and whose last column is the command. */
export function parseDockerTop(text: string): PsRow[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const header = lines.shift()?.trim().split(/\s+/) ?? [];
  const cmdAt = header.findIndex((h) => /^(CMD|COMMAND)$/i.test(h));
  const pidAt = header.findIndex((h) => h.toUpperCase() === "PID");
  if (cmdAt < 0 || pidAt < 0) return [];
  const rows: PsRow[] = [];
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    const pid = Number(cols[pidAt]);
    if (Number.isFinite(pid)) rows.push({ pid, ppid: 0, command: cols.slice(cmdAt).join(" ") });
  }
  return rows;
}

async function output(argv: string[], ms = 2000): Promise<string> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const timer = setTimeout(() => proc.kill(), ms);
  try {
    return await new Response(proc.stdout as ReadableStream).text();
  } finally {
    clearTimeout(timer);
  }
}

/** What the CLI of one run is executing now: the run itself first, then its child processes. Empty when the host cannot say. */
export async function listProcesses(
  run: RunningCli,
  dockerBin = "docker",
  platform: string = process.platform,
): Promise<ProcessInfo[]> {
  try {
    const own: ProcessInfo = {
      pid: run.pid,
      // The CLI's own command line holds the whole prompt: show only its name.
      command: run.harness,
      runningFor: Math.max(0, Math.round((Date.now() - run.startedAt) / 1000)),
    };
    let below: PsRow[] = [];
    if (run.container) below = parseDockerTop(await output([dockerBin, "top", run.container]));
    else if (platform !== "win32")
      below = descendants(
        parsePs(await output(["ps", "-A", "-o", "pid=,ppid=,etime=,command="])),
        run.pid,
      );
    return [
      own,
      ...below.slice(0, PROCESSES_MAX - 1).map((r) => ({
        pid: r.pid,
        command: redactCommand(r.command),
        ...(r.runningFor !== undefined ? { runningFor: r.runningFor } : {}),
      })),
    ];
  } catch {
    return [];
  }
}

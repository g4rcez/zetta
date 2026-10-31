import { createHash } from "node:crypto";
import { join } from "node:path";
import { ComputerError } from "./service";

/** One entry of `agent-browser --json batch`: a failed command has `success: false` and a message in `error`. */
export type AbResult = {
  command: string[];
  success: boolean;
  error: string | null;
  result: Record<string, unknown> | null;
};
export type AbRun = (
  cmds: string[][],
  o?: { timeoutMs?: number; signal?: AbortSignal | undefined },
) => Promise<AbResult[]>;

/** `ZETTA_AGENT_BROWSER_BIN`, then the package binary, then PATH. The override is needed for compiled server binaries. */
export async function abBin(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.ZETTA_AGENT_BROWSER_BIN) return env.ZETTA_AGENT_BROWSER_BIN;
  const local = join(process.cwd(), "node_modules", ".bin", "agent-browser");
  if (await Bun.file(local).exists()) return local;
  return Bun.which("agent-browser") ?? "agent-browser";
}

/** Short and deterministic: the daemon socket path (namespace + session) has a length limit. */
export const sessionName = (userId: string, profile: string) =>
  `z-${createHash("sha256").update(`${userId}\0${profile}`).digest("hex").slice(0, 20)}`;

/**
 * Runs `<prefix> --json batch --bail` with the commands as a JSON array on stdin. Typed text and secrets travel on stdin only:
 * they never appear in a process list. The environment is clean, so no AGENT_BROWSER_* or proxy setting of the server leaks in.
 */
export function batchRunner(prefix: string[], env: Record<string, string>): AbRun {
  return async (cmds, o = {}) => {
    if (o.signal?.aborted) throw new ComputerError("CANCELLED");
    const p = Bun.spawn([...prefix, "--json", "batch", "--bail"], {
      stdin: new TextEncoder().encode(JSON.stringify(cmds)),
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });
    let why: "slow" | "cancelled" | undefined;
    const timer = setTimeout(() => {
      why = "slow";
      p.kill();
    }, o.timeoutMs ?? 45_000);
    const abort = () => {
      why = "cancelled";
      p.kill();
    };
    o.signal?.addEventListener("abort", abort, { once: true });
    try {
      const [out] = await Promise.all([new Response(p.stdout).text(), p.exited]);
      if (why === "slow") throw new ComputerError("SLOW");
      if (why === "cancelled") throw new ComputerError("CANCELLED");
      const parsed = (() => {
        try {
          return JSON.parse(out) as unknown;
        } catch {
          return undefined;
        }
      })();
      if (!Array.isArray(parsed)) {
        // A daemon that is gone or a container that stopped is a lost connection, not a page problem.
        const err = await new Response(p.stderr).text();
        if (/No such container|is not running/i.test(err)) throw new ComputerError("DISCONNECTED");
        throw new ComputerError("UNAVAILABLE");
      }
      return parsed as AbResult[];
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", abort);
    }
  };
}

/** The server runs agent-browser itself (host mode). */
export function hostRunner(o: {
  bin: string;
  config: string;
  session: string;
  namespace: string;
  launch: string[];
}): AbRun {
  return batchRunner([o.bin, "--config", o.config, "--session", o.session, ...o.launch], {
    AGENT_BROWSER_NAMESPACE: o.namespace,
  });
}

/** agent-browser runs inside the session's container (docker mode). */
export function dockerRunner(o: {
  docker: string;
  container: string;
  config: string;
  session: string;
  launch: string[];
}): AbRun {
  return batchRunner(
    [
      o.docker,
      "exec",
      "-i",
      o.container,
      "agent-browser",
      "--config",
      o.config,
      "--session",
      o.session,
      ...o.launch,
    ],
    {},
  );
}

/** The failure text of the first command that failed, or undefined when all succeeded. */
export const firstError = (r: AbResult[]) => r.find((x) => !x.success)?.error ?? undefined;

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killGroup } from "../chat/harness";
import { hostVersion, LANGUAGES, PLAYGROUND_LIMITS } from "./languages";
import { collectOutputs, emptyResult, GRACE_MS, readResult, tail, writeFolder } from "./run-folder";
import { PlaygroundError, type Runner } from "./types";

/**
 * Runs a playground on the server host: the CLI of the language, in a fresh folder, with a clean environment, in its own process group.
 * The whole group is killed on timeout, cancel and when the script exits, so nothing outlives the run.
 * This is not a sandbox: the script runs as the server user, like a bot's Bash. Use the container runner to keep a script off the host.
 */
export const hostRunner: Runner = async (spec, signal) => {
  const cli = LANGUAGES[spec.language].cli;
  const version = await hostVersion(spec.language);
  const bin = cli ? Bun.which(cli.bin) : null;
  if (!cli || !version || !bin)
    throw new PlaygroundError(
      "UNAVAILABLE",
      `${cli?.bin ?? spec.language} is not installed on the server.`,
    );
  if (signal.aborted) return emptyResult("cancelled", version);

  const dir = await mkdtemp(join(tmpdir(), "zetta-playground-"));
  try {
    await writeFolder(dir, spec);
    const proc = Bun.spawn([bin, ...cli.args(spec.entry)], {
      cwd: dir,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: dir,
        TMPDIR: dir,
        LANG: "C",
        PYTHONUTF8: "1",
        ZETTA_INPUTS: JSON.stringify(spec.inputs),
      },
      stdin: spec.stdin === undefined ? "ignore" : Buffer.from(spec.stdin),
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    } as never);
    let reason: "timeout" | "cancelled" | undefined;
    const stop = (why: "timeout" | "cancelled") => {
      reason ??= why;
      killGroup(proc.pid);
    };
    const timer = setTimeout(() => stop("timeout"), spec.timeoutMs);
    const onAbort = () => stop("cancelled");
    signal.addEventListener("abort", onAbort, { once: true });
    const out = tail(proc.stdout, PLAYGROUND_LIMITS.streamBytes);
    const err = tail(proc.stderr, PLAYGROUND_LIMITS.streamBytes);
    try {
      await proc.exited;
      // The script is done: end anything it left running, then give the pipes a moment to drain.
      killGroup(proc.pid);
      await Promise.race([Promise.all([out.done, err.done]), Bun.sleep(GRACE_MS)]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
    const kept = await collectOutputs(join(dir, "out"));
    const result = await readResult(dir, spec);
    const code = proc.exitCode;
    return {
      status: reason ?? (code === 0 ? "ok" : "failed"),
      exitCode: reason ? null : code,
      stdout: out.text(),
      stderr: err.text(),
      truncated: out.cut() || err.cut() || kept.cut,
      outputs: kept.outputs,
      runtimeVersion: version,
      ...(result !== undefined && { result }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

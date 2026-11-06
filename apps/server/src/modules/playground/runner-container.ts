import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { containerUser, engineOf, tmpfsOwner, type Engine } from "../container-user";
import { LANGUAGES, PLAYGROUND_LIMITS, type Cli } from "./languages";
import { collectOutputs, emptyResult, GRACE_MS, tail, writeFolder } from "./run-folder";
import { PlaygroundError, type Runner } from "./types";

export type ContainerConfig = {
  bin: string;
  engine: Engine;
  /** The host folder that every language container mounts at `/runs`. Each run gets a folder in it. */
  runsDir: string;
  /** Container names start with this. A test uses its own, so it never touches the ones of a running server. */
  prefix: string;
  memory: string;
  cpus: string;
  pids: number;
  /** An engine network name; `none` closes the network. Unset means the engine's default network. */
  network: string | undefined;
  /** An image per CLI binary (`bun`, `python3`, `bash`), when it is not the one of the language map. */
  images: Partial<Record<string, string>>;
};

/**
 * The container runner is on when the container engine binary exists (`ZETTA_DOCKER_BIN`, default `docker`). Everything else has a default:
 * `ZETTA_PLAYGROUND_DIR`, `_MEMORY`, `_CPUS`, `_PIDS`, `_NETWORK` (`none` closes the network) and `ZETTA_PLAYGROUND_IMAGE_<BIN>` (for example `_PYTHON3`).
 * The runs folder is under the home directory by default: a Podman machine shares it with its VM, and shares `/var/folders` with nothing.
 */
export function containerConfig(env: NodeJS.ProcessEnv = process.env): ContainerConfig | undefined {
  const bin = env.ZETTA_DOCKER_BIN ?? "docker";
  if (!Bun.which(bin)) return undefined;
  const images: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const m = /^ZETTA_PLAYGROUND_IMAGE_([A-Z0-9_]+)$/.exec(key);
    if (m && value) images[m[1]!.toLowerCase()] = value;
  }
  return {
    bin,
    engine: engineOf(bin, env),
    runsDir: env.ZETTA_PLAYGROUND_DIR ?? join(homedir(), ".zetta", "playground"),
    prefix: "zetta-playground-",
    memory: env.ZETTA_PLAYGROUND_MEMORY ?? "1g",
    cpus: env.ZETTA_PLAYGROUND_CPUS ?? "2",
    pids: Number(env.ZETTA_PLAYGROUND_PIDS ?? 256),
    network: env.ZETTA_PLAYGROUND_NETWORK || undefined,
    images,
  };
}

/** The argv that starts the container of one language. Pure, so a test can read the policy. The container idles; every run is an `exec`. */
export function containerArgs(c: ContainerConfig, o: { name: string; image: string }) {
  return [
    "run",
    "-d",
    "--init",
    "--name",
    o.name,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--pids-limit",
    String(c.pids),
    "--memory",
    c.memory,
    "--cpus",
    c.cpus,
    "--user",
    containerUser().user,
    // Rootless Podman maps the container user to a sub-uid unless it keeps the uid of the server user, who owns the runs folder.
    ...(c.engine === "podman" ? ["--userns=keep-id"] : []),
    "--tmpfs",
    `/tmp:rw,size=256m${tmpfsOwner(c.engine)}`,
    ...(c.network ? ["--network", c.network] : []),
    "-v",
    `${c.runsDir}:/runs:rw`,
    o.image,
    "sleep",
    "infinity",
  ];
}

type Done = { code: number | null; stdout: string; stderr: string };

/**
 * Runs playgrounds in containers: one long-lived container per CLI (so `typescript` and `javascript` share the `bun` one), started on first use.
 * A run is an `exec` in its own folder under `/runs`, with the time limit enforced inside by `timeout`. Runs of one language share a container,
 * so they are not isolated from each other; the container keeps a script off the host (no capabilities, read-only root, limits).
 */
export function createContainerRunner(c: ContainerConfig) {
  const engine = async (
    args: string[],
    o: { timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<Done> => {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([c.bin, ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...o.env },
        timeout: o.timeoutMs ?? 30_000,
      });
    } catch {
      throw new PlaygroundError("UNAVAILABLE", "The container engine could not be started.");
    }
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  };

  const nameOf = (cli: Cli) => `${c.prefix}${cli.bin}`;
  const versions = new Map<string, string>();
  const starting = new Map<string, Promise<string>>();

  /** The container of a CLI is up, and its version. Two runs that need it at once start it once. */
  const ensure = (cli: Cli) => {
    const name = nameOf(cli);
    let p = starting.get(name);
    if (!p) {
      p = start(cli, name).finally(() => starting.delete(name));
      starting.set(name, p);
    }
    return p;
  };
  async function start(cli: Cli, name: string) {
    const state = await engine(["inspect", "-f", "{{.State.Running}}", name]);
    if (state.code === 0 && state.stdout.trim() === "true" && versions.has(name))
      return versions.get(name)!;
    if (state.code === 0) await engine(["rm", "-f", name]);
    await mkdir(c.runsDir, { recursive: true, mode: 0o700 });
    // The first run of a language may pull the image: allow minutes.
    const started = await engine(
      containerArgs(c, { name, image: c.images[cli.bin] ?? cli.image }),
      { timeoutMs: 300_000 },
    );
    if (started.code !== 0) {
      console.error(`playground: container start failed bin=${cli.bin} code=${started.code}`);
      throw new PlaygroundError(
        "UNAVAILABLE",
        `The ${cli.bin} container could not start. Check that the image can be pulled.`,
      );
    }
    const asked = await engine(["exec", name, cli.bin, ...cli.version]);
    const version = asked.stdout.split("\n")[0]?.trim().slice(0, 80) || "unknown";
    versions.set(name, version);
    return version;
  }

  const run: Runner = async (spec, signal) => {
    const cli = LANGUAGES[spec.language].cli;
    if (!cli)
      throw new PlaygroundError("INVALID", "This language has no CLI to run in a container.");
    const name = nameOf(cli);
    const version = await ensure(cli);
    if (signal.aborted) return emptyResult("cancelled", version);

    const dir = await mkdtemp(join(c.runsDir, "r-"));
    const inside = `/runs/${basename(dir)}`;
    // The process group of the run is the one of `timeout`, whose pid `sh` wrote down before it replaced itself with `timeout`.
    const killInside = () =>
      engine([
        "exec",
        name,
        "sh",
        "-c",
        `kill -KILL -- -$(cat ${inside}/.pid) 2>/dev/null; true`,
      ]).catch(() => {});
    try {
      await writeFolder(dir, spec);
      const seconds = Math.ceil(spec.timeoutMs / 1000);
      const proc = Bun.spawn(
        [
          c.bin,
          "exec",
          "-w",
          inside,
          "-e",
          `HOME=${inside}`,
          "-e",
          `TMPDIR=${inside}`,
          "-e",
          "LANG=C",
          "-e",
          "PYTHONUTF8=1",
          // No value: the engine reads it from our environment, so the inputs never show in a process list.
          "-e",
          "ZETTA_INPUTS",
          name,
          "sh",
          "-c",
          'echo $$ > .pid; exec timeout -s KILL "$0" "$@"',
          String(seconds),
          cli.bin,
          ...cli.args(spec.entry),
        ],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, ZETTA_INPUTS: JSON.stringify(spec.inputs) },
        },
      );
      const started = Date.now();
      let reason: "timeout" | "cancelled" | undefined;
      const stop = (why: "timeout" | "cancelled") => {
        reason ??= why;
        void killInside();
        proc.kill();
      };
      // The limit inside should fire first. This one is for a container that stopped answering.
      const timer = setTimeout(() => stop("timeout"), spec.timeoutMs + 5000);
      const onAbort = () => stop("cancelled");
      signal.addEventListener("abort", onAbort, { once: true });
      const out = tail(proc.stdout, PLAYGROUND_LIMITS.streamBytes);
      const err = tail(proc.stderr, PLAYGROUND_LIMITS.streamBytes);
      try {
        await proc.exited;
        // End anything the script left running, then give the pipes a moment to drain.
        await killInside();
        await Promise.race([Promise.all([out.done, err.done]), Bun.sleep(GRACE_MS)]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
      const kept = await collectOutputs(join(dir, "out"));
      const code = proc.exitCode;
      // With `-s KILL`, `timeout` answers 137 (the kill signal) when it ended the script; without it, 124. A script that exits with
      // one of these by itself, before the limit, is a plain failure.
      const timedOut =
        !reason && (code === 124 || code === 137) && Date.now() - started >= seconds * 1000 - 500;
      const why = reason ?? (timedOut ? "timeout" : undefined);
      return {
        status: why ?? (code === 0 ? "ok" : "failed"),
        exitCode: why ? null : code,
        stdout: out.text(),
        stderr: err.text(),
        truncated: out.cut() || err.cut() || kept.cut,
        outputs: kept.outputs,
        runtimeVersion: version,
      };
    } finally {
      // A folder the container user cannot hand back stays until the next boot sweep.
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };

  /** At boot: removes the language containers of a previous process and the run folders they left. */
  async function sweep() {
    const listed = await engine([
      "ps",
      "-a",
      "--filter",
      `name=${c.prefix}`,
      "--format",
      "{{.Names}}",
    ]);
    for (const name of listed.stdout.split("\n").map((l) => l.trim()))
      if (name.startsWith(c.prefix)) await engine(["rm", "-f", name]);
    versions.clear();
    for (const entry of await readdir(c.runsDir).catch(() => [] as string[]))
      if (entry.startsWith("r-"))
        await rm(join(c.runsDir, entry), { recursive: true, force: true }).catch(() => {});
  }

  return { run, sweep };
}

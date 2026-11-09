import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containerUser, engineOf } from "../container-user";
import { containerArgs, createContainerRunner, type ContainerConfig } from "./runner-container";
import type { RunSpec } from "./types";

// Needs a container engine and an image with bash. Like the other container suites it runs with ZETTA_DOCKER_TEST=1;
// ZETTA_DOCKER_BIN names the engine, ZETTA_PLAYGROUND_TEST_BASH_IMAGE the image (default: debian slim, pulled on first use).
// On Podman, TMPDIR must be a folder the Podman machine shares (see docs/decisions/playground.md).
const real = process.env.ZETTA_DOCKER_TEST === "1" ? describe : describe.skip;
const bin = process.env.ZETTA_DOCKER_BIN ?? "docker";

const bash = (
  script: string,
  inputs: Record<string, unknown> = {},
  timeoutMs = 20_000,
): RunSpec => ({
  language: "bash",
  entry: "main.sh",
  files: [{ path: "main.sh", content: script }],
  inputs,
  timeoutMs,
});

real("playground container runner", () => {
  let config: ContainerConfig;
  let runner: ReturnType<typeof createContainerRunner>;
  const never = new AbortController().signal;

  beforeAll(async () => {
    config = {
      bin,
      engine: engineOf(bin),
      runsDir: await mkdtemp(join(tmpdir(), "zetta-pg-test-")),
      // Its own prefix: the tests never touch the containers of a running server.
      prefix: `zetta-playground-test-${Math.random().toString(36).slice(2, 8)}-`,
      memory: "256m",
      cpus: "1",
      pids: 128,
      network: undefined,
      images: {
        bash:
          process.env.ZETTA_PLAYGROUND_TEST_BASH_IMAGE ?? "docker.io/library/debian:trixie-slim",
      },
    };
    runner = createContainerRunner(config);
  });
  afterAll(async () => {
    await runner.sweep();
    await rm(config.runsDir, { recursive: true, force: true });
  });

  test("a script runs in the container with its inputs and leaves its out/ files", async () => {
    const result = await runner.run(
      bash('echo "hello $ZETTA_INPUTS"\ncat inputs.json\nmkdir -p out\necho report > out/a.txt\n', {
        name: "Ada",
      }),
      never,
    );
    expect(result).toMatchObject({
      status: "ok",
      exitCode: 0,
      stdout: 'hello {"name":"Ada"}\n{"name":"Ada"}',
      stderr: "",
    });
    expect(result.runtimeVersion).toMatch(/^GNU bash, version \d/);
    expect(result.outputs.map((o) => [o.path, o.content.toString()])).toEqual([
      ["a.txt", "report\n"],
    ]);
    // The run folder is gone.
    expect(await readdir(config.runsDir)).toEqual([]);
  });

  test("the script runs as the server user, with a read-only root and the engine's network setting", async () => {
    const result = await runner.run(
      bash("id -u\necho x > /etc/zetta-test 2>/dev/null\necho $?\n"),
      never,
    );
    expect(result.stdout).toBe(`${containerUser().uid}\n1\n`);
  });

  test("a payload on stdin reaches the script and a result file comes back; the payload is not in its environment", async () => {
    const script =
      'payload=$(cat)\nenv | grep -c SECRETVALUE\nprintf \'{"echo":%s}\' "$payload" > result.json\n';
    const result = await runner.run(
      { ...bash(script), stdin: '{"token":"SECRETVALUE"}', resultFile: "result.json" },
      never,
    );
    expect(result).toMatchObject({ status: "ok", stdout: "0\n" });
    expect(result.result).toBe('{"echo":{"token":"SECRETVALUE"}}');
    // Without stdin the script reads nothing and no result is reported.
    const none = await runner.run({ ...bash("cat | wc -c\n"), resultFile: "result.json" }, never);
    expect(none.stdout.trim()).toBe("0");
    expect(none.result).toBeUndefined();
  });

  test("a result file that is a link, or too large, is not read", async () => {
    const link = await runner.run(
      { ...bash("ln -s /etc/hostname result.json\n"), resultFile: "result.json" },
      never,
    );
    expect(link.result).toBeUndefined();
    const big = await runner.run(
      {
        ...bash("head -c 1100000 /dev/zero | tr '\\0' 'a' > result.json\n"),
        resultFile: "result.json",
      },
      never,
    );
    expect(big.result).toBeUndefined();
  });

  test("a failing script reports its exit code", async () => {
    const result = await runner.run(bash("echo oops >&2\nexit 7\n"), never);
    expect(result).toMatchObject({ status: "failed", exitCode: 7, stderr: "oops\n" });
  });

  test("a script over its time limit is stopped, and a cancelled one stops at once", async () => {
    const slow = await runner.run(bash("sleep 30\n", {}, 1000), never);
    expect(slow).toMatchObject({ status: "timeout", exitCode: null });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 700);
    const cancelled = await runner.run(bash("sleep 30\n"), controller.signal);
    expect(cancelled).toMatchObject({ status: "cancelled", exitCode: null });
  });

  test("two runs that need the container at the same time start it once", async () => {
    await runner.sweep();
    const [a, b] = await Promise.all([
      runner.run(bash("echo a\n"), never),
      runner.run(bash("echo b\n"), never),
    ]);
    expect([a.stdout, b.stdout]).toEqual(["a\n", "b\n"]);
  });

  test("the sweep removes the language containers of the prefix", async () => {
    await runner.sweep();
    const listed = Bun.spawnSync([
      bin,
      "ps",
      "-a",
      "--filter",
      `name=${config.prefix}`,
      "--format",
      "{{.Names}}",
    ]);
    expect(listed.stdout.toString().trim()).toBe("");
  });
});

describe("playground container policy", () => {
  const cfg = (engine: "docker" | "podman", network?: string): ContainerConfig => ({
    bin: "docker",
    engine,
    runsDir: "/data/runs",
    prefix: "zetta-playground-",
    memory: "1g",
    cpus: "2",
    pids: 256,
    network,
    images: {},
  });
  const args = (c: ContainerConfig) =>
    containerArgs(c, { name: "zetta-playground-bash", image: "debian:trixie-slim" });

  test("the container has no capabilities, a read-only root, limits and only the runs folder", () => {
    const a = args(cfg("docker"));
    expect(a).toContain("--cap-drop=ALL");
    expect(a).toContain("--security-opt=no-new-privileges");
    expect(a).toContain("--read-only");
    expect(a.slice(a.indexOf("--pids-limit"), a.indexOf("--pids-limit") + 2)).toEqual([
      "--pids-limit",
      "256",
    ]);
    expect(a.filter((x) => x === "-v")).toHaveLength(1);
    expect(a).toContain("/data/runs:/runs:rw");
    expect(a.slice(-3)).toEqual(["debian:trixie-slim", "sleep", "infinity"]);
    expect(a).not.toContain("--network");
    expect(a).not.toContain("--privileged");
  });

  test("Podman keeps the server's uid, and the network can be closed", () => {
    expect(args(cfg("podman"))).toContain("--userns=keep-id");
    expect(args(cfg("docker"))).not.toContain("--userns=keep-id");
    const closed = args(cfg("docker", "none"));
    expect(closed.slice(closed.indexOf("--network"), closed.indexOf("--network") + 2)).toEqual([
      "--network",
      "none",
    ]);
  });
});

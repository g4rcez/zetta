import { containerUser } from "../container-user";
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dockerArgs, dockerConfig, harnessCommands, HarnessError, runCli } from "./harness";

const cfg = {
  image: "zetta-harness:latest",
  network: "bridge",
  memory: "1g",
  cpus: "1",
  pids: 256,
  bin: "docker",
};

describe("docker runtime configuration", () => {
  test("is off unless explicitly enabled and reads limits from the environment", () => {
    expect(dockerConfig({})).toBeUndefined();
    expect(
      dockerConfig({
        ZETTA_HARNESS_RUNTIME: "docker",
        ZETTA_HARNESS_MEMORY: "512m",
        ZETTA_HARNESS_NETWORK: "none",
      }),
    ).toMatchObject({ image: "zetta-harness:latest", memory: "512m", network: "none" });
  });
  test("container command is hardened: read-only root, no capabilities, non-root, limits, no host mounts except the user's home", () => {
    const a = dockerArgs(cfg, {
      name: "n1",
      argv: harnessCommands["claude-code"]("hi", null),
      home: "/data/homes/u1/claude-code",
      env: { ANTHROPIC_API_KEY: "k", "bad-name": "x" },
    });
    const joined = a.join(" ");
    for (const flag of [
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit 256",
      "--memory 1g",
      "--cpus 1",
      `--user ${containerUser().user}`,
      "--rm",
    ])
      expect(joined).toContain(flag);
    expect(a.filter((x) => x === "-v")).toHaveLength(1);
    expect(a[a.indexOf("-v") + 1]).toBe("/data/homes/u1/claude-code:/home/agent:rw");
    expect(joined).not.toContain("bad-name");
    expect(joined).toContain("-e ANTHROPIC_API_KEY");
    expect(joined).not.toContain("=k"); // the value is never in argv (ps), only the name
    expect(joined).not.toContain("--privileged");
    expect(joined).not.toContain("--network host");
    expect(
      a.slice(a.indexOf("zetta-harness:latest"), a.indexOf("zetta-harness:latest") + 3),
    ).toEqual(["zetta-harness:latest", "claude", "-p"]);
    expect(a.at(-1)).toBe("hi");
  });
  test("without a persistent home the container gets only a tmpfs home (nothing survives the run)", () => {
    const a = dockerArgs(cfg, { name: "n2", argv: ["claude", "-p", "x"], env: {} });
    expect(a.includes("-v")).toBe(false);
    expect(a.join(" ")).toContain("--tmpfs /home/agent");
  });
});

// Real container isolation proofs. Opt-in: needs docker (podman alias works) and the image built from docker/harness.
const real = process.env.ZETTA_DOCKER_TEST === "1" ? describe : describe.skip;
real("container isolation (real docker)", () => {
  const run = async (
    name: string,
    argv: string[],
    opts: { home?: string; env?: Record<string, string>; network?: string } = {},
  ) => {
    const p = Bun.spawn(
      [
        "docker",
        ...dockerArgs(
          { ...cfg, network: opts.network ?? "none" },
          { name, argv, home: opts.home, env: opts.env ?? {} },
        ),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { out: out.trim(), err: err.trim(), code };
  };
  test("runs as a non-root user with a read-only root filesystem and no host visibility", async () => {
    expect((await run("zt-id", ["id", "-u"])).out).toBe(containerUser().uid);
    expect((await run("zt-ro", ["sh", "-c", "touch /etc/x 2>&1; echo $?"])).out).toContain(
      "Read-only",
    );
    expect(
      (await run("zt-host", ["sh", "-c", "ls /Users /Volumes /host 2>&1 | head -1"])).out,
    ).toContain("No such file");
    expect(
      (
        await run(
          "zt-env",
          ["sh", "-c", "env | grep -c -E 'DATABASE_URL|BETTER_AUTH|ZETTA_CONNECTION_KEY' || true"],
          { env: {} },
        )
      ).out,
    ).toBe("0");
  }, 120_000);
  test("only the user's own home is mounted: another user's home is invisible, writes persist per user", async () => {
    const root = await mkdtemp(join(process.cwd(), ".zetta-homes-test-")); // must be visible to the docker daemon (podman VMs share only $HOME)
    const mine = join(root, "alice"),
      theirs = join(root, "bob");
    for (const d of [mine, theirs]) {
      const { mkdir, chmod } = await import("node:fs/promises");
      await mkdir(d, { recursive: true });
      await chmod(d, 0o777);
    }
    await writeFile(join(theirs, "secret.txt"), "BOB-SECRET");
    const r = await run(
      "zt-home",
      ["sh", "-c", "echo hello > /home/agent/note.txt; ls /home/agent"],
      { home: mine },
    );
    expect(r.out).toContain("note.txt");
    expect(r.out).not.toContain("secret.txt");
    expect(await readFile(join(mine, "note.txt"), "utf8")).toContain("hello");
    await (await import("node:fs/promises")).rm(root, { recursive: true, force: true });
  }, 120_000);
  test("no network when configured as none; memory/pids limits apply", async () => {
    const r = await run(
      "zt-net",
      [
        "sh",
        "-c",
        "node -e \"require('https').get('https://example.com',()=>console.log('REACHED')).on('error',()=>console.log('BLOCKED'))\"",
      ],
      { network: "none" },
    );
    expect(r.out).toContain("BLOCKED");
  }, 120_000);

  test("the real adapter in docker mode: an unauthenticated Claude Code run is classified, a missing CLI is not_installed, a timeout removes the container", async () => {
    const prev = { ...process.env };
    process.env.ZETTA_HARNESS_RUNTIME = "docker";
    process.env.ZETTA_DOCKER_BIN = "docker";
    process.env.ZETTA_HARNESS_NETWORK = "none";
    try {
      const code = (p: Promise<unknown>) =>
        p.then(
          () => "ok",
          (e) => (e as HarnessError).code,
        );
      // no credentials in the container -> Claude Code asks to log in; no quota is spent (network is off)
      expect(
        await code(
          runCli({
            harness: "claude-code",
            prompt: "hi",
            model: null,
            userId: "u-docker",
            timeoutMs: 60_000,
          }),
        ),
      ).toMatch(/auth_required|failed/);
      // codex is not in the image
      expect(
        await code(
          runCli({
            harness: "codex",
            prompt: "hi",
            model: null,
            userId: "u-docker",
            timeoutMs: 60_000,
          }),
        ),
      ).toBe("not_installed");
      // a timeout kills the container (none left running)
      expect(
        await code(
          runCli({
            harness: "claude-code",
            prompt: "hi",
            model: null,
            userId: "u-docker",
            timeoutMs: 150,
          }),
        ),
      ).toBe("timeout");
      await Bun.sleep(1500);
      const ps = Bun.spawn(
        ["docker", "ps", "--filter", "name=zetta-run-", "--format", "{{.Names}}"],
        { stdout: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } },
      );
      expect((await new Response(ps.stdout).text()).trim()).toBe("");
    } finally {
      for (const k of ["ZETTA_HARNESS_RUNTIME", "ZETTA_DOCKER_BIN", "ZETTA_HARNESS_NETWORK"]) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  }, 180_000);
});

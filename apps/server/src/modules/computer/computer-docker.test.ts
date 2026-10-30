import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserDockerArgs,
  ComputerError,
  createComputerService,
  dockerBrowserConfig,
  ensureBrowserNetwork,
} from "./service";

const cfg = { bin: "docker", image: "zetta-browser:latest", memory: "1g", cpus: "1", pids: 512 };
describe("browser container configuration", () => {
  test("is off unless enabled; the container is hardened and exposes CDP on loopback only", () => {
    expect(dockerBrowserConfig({})).toBeUndefined();
    expect(dockerBrowserConfig({ ZETTA_BROWSER_RUNTIME: "docker" })).toMatchObject({
      image: "zetta-browser:latest",
    });
    const a = browserDockerArgs(cfg, { name: "b1", profileDir: "/data/p" });
    const j = a.join(" ");
    for (const f of [
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--read-only",
      "--pids-limit 512",
      "--memory 1g",
      "-p 127.0.0.1::9222",
      "-v /data/p:/profile:rw",
    ])
      expect(j).toContain(f);
    expect(j).not.toContain("--privileged");
    expect(j).not.toContain("--network host");
    expect(a.filter((x) => x === "-v")).toHaveLength(1);
  });
  test("a dedicated network is passed on when the operator names one, and none otherwise", () => {
    const j = (c: Parameters<typeof browserDockerArgs>[0]) =>
      browserDockerArgs(c, { name: "b1", profileDir: "/data/p" }).join(" ");
    expect(
      j({ ...dockerBrowserConfig({ ZETTA_BROWSER_RUNTIME: "docker" })!, network: "zetta-browser" }),
    ).toContain("--network zetta-browser");
    expect(
      j({ ...dockerBrowserConfig({ ZETTA_BROWSER_RUNTIME: "docker" })!, network: undefined }),
    ).not.toContain("--network");
    expect(dockerBrowserConfig({ ZETTA_BROWSER_RUNTIME: "docker" })!.network).toBe("zetta-browser"); // own network unless told otherwise
    expect(
      dockerBrowserConfig({ ZETTA_BROWSER_RUNTIME: "docker", ZETTA_BROWSER_NETWORK: "" })!.network,
    ).toBe("");
    expect(
      dockerBrowserConfig({ ZETTA_BROWSER_RUNTIME: "docker", ZETTA_BROWSER_NETWORK: "mine" })!
        .network,
    ).toBe("mine");
  });
});

// Real containers: opt-in (needs docker and `docker build -t zetta-browser:latest docker/browser`).
const real = process.env.ZETTA_DOCKER_TEST === "1" ? describe : describe.skip;
real("computer sessions in docker (real)", () => {
  let root: string;
  const server = Bun.serve({
    port: 0,
    hostname: "0.0.0.0",
    fetch: () =>
      new Response("<html><body><h1>Hello from the host</h1></body></html>", {
        headers: { "content-type": "text/html" },
      }),
  });
  const names = async () => {
    const p = Bun.spawn(
      ["docker", "ps", "--filter", "name=zetta-browser-", "--format", "{{.Names}}"],
      { stdout: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } },
    );
    return (await new Response(p.stdout).text()).trim();
  };
  afterAll(async () => {
    server.stop(true);
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("a session runs in its own container, reads a page, is isolated from the host filesystem, and the container disappears on close", async () => {
    root = await mkdtemp(join(process.cwd(), ".zetta-browser-test-"));
    const svc = createComputerService({ docker: cfg, root, allowPrivate: true });
    try {
      await svc.start("du1", "p1");
      expect((await names()).split("\n").filter(Boolean)).toHaveLength(1);
      const text = await svc.read("du1", "p1", `http://host.docker.internal:${server.port}/`);
      expect(text).toContain("Hello from the host");
      expect((await svc.screenshot("du1", "p1")).length).toBeGreaterThan(1000);
      // file:// is blocked by policy and the container cannot see host files either way
      expect(
        await svc.act("du1", "p1", "agent", { type: "open", url: "file:///etc/hostname" }).then(
          () => "ok",
          (e) => (e as ComputerError).code,
        ),
      ).not.toBe("ok");
      await svc.close("du1", "p1");
      await Bun.sleep(1500);
      expect(await names()).toBe("");
    } finally {
      await svc.closeAll();
    }
  }, 180_000);

  test("two users get two separate containers; the SSRF policy still applies in docker mode", async () => {
    const svc = createComputerService({ docker: cfg, root, allowPrivate: false });
    try {
      await svc.start("du2", "a");
      await svc.start("du3", "a");
      expect((await names()).split("\n").filter(Boolean)).toHaveLength(2);
      expect(
        await svc
          .act("du2", "a", "agent", {
            type: "open",
            url: "http://169.254.169.254/latest/meta-data",
          })
          .then(
            () => "ok",
            (e) => (e as ComputerError).code,
          ),
      ).toBe("BLOCKED_URL");
      expect(
        await svc.screenshot("du3", "zzz").then(
          () => "ok",
          (e) => (e as ComputerError).code,
        ),
      ).toBe("NOT_FOUND");
    } finally {
      await svc.closeAll();
    }
    await Bun.sleep(1500);
    expect(await names()).toBe("");
  }, 180_000);
});

describe("browser network", () => {
  // A stand-in for the docker binary: logs its arguments and fails the commands named in FAIL (a regex on the argument line).
  const fakeDocker = async (fail: string) => {
    const dir = await mkdtemp(join(tmpdir(), "fake-docker-"));
    const bin = join(dir, "docker");
    await writeFile(
      bin,
      `#!/bin/sh\necho "$@" >> "${dir}/log"\ncase "$*" in ${fail}) exit 1;; esac\nexit 0\n`,
    );
    await chmod(bin, 0o755);
    return {
      bin,
      log: async () =>
        (await readFile(join(dir, "log"), "utf8").catch(() => "")).trim().split("\n"),
    };
  };
  const base = { image: "i", memory: "1g", cpus: "1", pids: 1 };
  test("an existing network is reused as it is", async () => {
    const d = await fakeDocker("nothing-matches");
    expect(await ensureBrowserNetwork({ ...base, bin: d.bin, network: "net-existing" })).toBe(
      "net-existing",
    );
    expect(await d.log()).toEqual(["network inspect net-existing"]);
  });
  test("a missing network is created with inter-container traffic off", async () => {
    const d = await fakeDocker("*inspect*");
    expect(await ensureBrowserNetwork({ ...base, bin: d.bin, network: "net-new" })).toBe("net-new");
    expect(await d.log()).toEqual([
      "network inspect net-new",
      "network create -o com.docker.network.bridge.enable_icc=false net-new",
    ]);
  });
  test("an engine that refuses that option still gets its own network; one that refuses networks falls back to the default", async () => {
    const podman = await fakeDocker("*inspect*|*enable_icc*");
    expect(await ensureBrowserNetwork({ ...base, bin: podman.bin, network: "net-podman" })).toBe(
      "net-podman",
    );
    const none = await fakeDocker("*network*");
    expect(
      await ensureBrowserNetwork({ ...base, bin: none.bin, network: "net-none" }),
    ).toBeUndefined();
    expect(await ensureBrowserNetwork({ ...base, bin: none.bin, network: "" })).toBeUndefined();
  });
});

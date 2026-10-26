import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { browserDockerArgs, ComputerError, createComputerService, dockerBrowserConfig } from "./service";

const cfg = { bin: "docker", image: "zetta-browser:latest", memory: "1g", cpus: "1", pids: 512 };
describe("browser container configuration", () => {
  test("is off unless enabled; the container is hardened and exposes CDP on loopback only", () => {
    expect(dockerBrowserConfig({})).toBeUndefined();
    expect(dockerBrowserConfig({ ZETTA_BROWSER_RUNTIME: "docker" })).toMatchObject({ image: "zetta-browser:latest" });
    const a = browserDockerArgs(cfg, { name: "b1", profileDir: "/data/p" }); const j = a.join(" ");
    for (const f of ["--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--pids-limit 512", "--memory 1g", "-p 127.0.0.1::9222", "-v /data/p:/profile:rw"]) expect(j).toContain(f);
    expect(j).not.toContain("--privileged"); expect(j).not.toContain("--network host"); expect(a.filter((x) => x === "-v")).toHaveLength(1);
  });
});

// Real containers: opt-in (needs docker and `docker build -t zetta-browser:latest docker/browser`).
const real = process.env.ZETTA_DOCKER_TEST === "1" ? describe : describe.skip;
real("computer sessions in docker (real)", () => {
  let root: string;
  const server = Bun.serve({ port: 0, hostname: "0.0.0.0", fetch: () => new Response("<html><body><h1>Hello from the host</h1></body></html>", { headers: { "content-type": "text/html" } }) });
  const names = async () => { const p = Bun.spawn(["docker", "ps", "--filter", "name=zetta-browser-", "--format", "{{.Names}}"], { stdout: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } }); return (await new Response(p.stdout).text()).trim(); };
  afterAll(async () => { server.stop(true); if (root) await rm(root, { recursive: true, force: true }); });

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
    expect(await svc.act("du1", "p1", "agent", { type: "open", url: "file:///etc/hostname" }).then(() => "ok", (e) => (e as ComputerError).code)).not.toBe("ok");
    await svc.close("du1", "p1");
    await Bun.sleep(1500);
    expect(await names()).toBe("");
    } finally { await svc.closeAll(); }
  }, 180_000);

  test("two users get two separate containers; the SSRF policy still applies in docker mode", async () => {
    const svc = createComputerService({ docker: cfg, root, allowPrivate: false });
    try {
    await svc.start("du2", "a"); await svc.start("du3", "a");
    expect((await names()).split("\n").filter(Boolean)).toHaveLength(2);
    expect(await svc.act("du2", "a", "agent", { type: "open", url: "http://169.254.169.254/latest/meta-data" }).then(() => "ok", (e) => (e as ComputerError).code)).toBe("BLOCKED_URL");
    expect(await svc.screenshot("du3", "zzz").then(() => "ok", (e) => (e as ComputerError).code)).toBe("NOT_FOUND");
    } finally { await svc.closeAll(); }
    await Bun.sleep(1500);
    expect(await names()).toBe("");
  }, 180_000);
});

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpCall } from "./desktop";
import { ComputerError } from "./service";
import { createVmService, vmDockerArgs, type VmDocker, type VmExec, type VmRow, type VmStore } from "./vm";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as ComputerError).code);
const docker: VmDocker = { bin: "docker", image: "zetta-desktop:latest", memory: "2g", cpus: "2", pids: 1024, shm: "1g" };

function memoryStore(): VmStore & { rows: VmRow[] } {
  const rows: VmRow[] = [];
  const row = (userId: string, v: Partial<VmRow>): VmRow => ({ id: crypto.randomUUID(), ownerUserId: userId, name: "Default", kind: "default", createdByBotId: null, purpose: null, status: "stopped", createdAt: new Date(), lastStartedAt: null, deletedAt: null, ...v });
  const live = (u: string) => rows.filter((r) => r.ownerUserId === u && r.status !== "deleted");
  return {
    rows,
    list: async (u) => live(u),
    get: async (u, id) => live(u).find((r) => r.id === id),
    ensureDefault: async (u) => { const hit = live(u).find((r) => r.kind === "default"); if (hit) return hit; const r = row(u, {}); rows.push(r); return r; },
    create: async (u, v) => { const r = row(u, { kind: "extra", name: v.name, purpose: v.purpose ?? null, createdByBotId: v.botId ?? null }); rows.push(r); return r; },
    count: async (u) => live(u).length,
    setStatus: async (id, status) => { const r = rows.find((x) => x.id === id)!; r.status = status; },
    resetRunning: async () => { for (const r of rows) if (r.status === "running") r.status = "stopped"; },
  };
}
/** Fake container CLI: tracks containers/volumes by name; `docker start` only works for an existing (stopped) container. */
function fakeDocker() {
  const containers = new Map<string, "running" | "exited">(); const volumes = new Set<string>(); const log: string[][] = [];
  const images = new Map<string, string>(); const image = { current: "sha256:v1" };
  const exec: VmExec = async (args) => {
    log.push(args);
    const [cmd] = args; const name = args[args.length - 1]!;
    if (cmd === "run") { const n = args[args.indexOf("--name") + 1]!; containers.set(n, "running"); images.set(n, image.current); volumes.add(n); return { code: 0, stdout: "id\n" }; }
    if (cmd === "start") { if (!containers.has(name)) return { code: 1, stdout: "" }; containers.set(name, "running"); return { code: 0, stdout: "" }; }
    if (cmd === "stop") { if (containers.has(name)) containers.set(name, "exited"); return { code: 0, stdout: "" }; }
    if (cmd === "rm") { containers.delete(name); return { code: 0, stdout: "" }; }
    if (cmd === "volume") { volumes.delete(name); return { code: 0, stdout: "" }; }
    if (cmd === "port") return { code: 0, stdout: "127.0.0.1:41234\n" };
    if (cmd === "ps") return { code: 0, stdout: [...containers.keys()].join("\n") };
    if (cmd === "inspect") return containers.has(name) ? { code: 0, stdout: `${images.get(name)}\n` } : { code: 1, stdout: "" };
    if (cmd === "image") return { code: 0, stdout: `${image.current}\n` };
    return { code: 1, stdout: "" };
  };
  return { exec, containers, volumes, log, image };
}
function fakeMcp() {
  const calls: { tool: string; args: Record<string, unknown>; token: string }[] = [];
  const connect = async (_port: number, token: string) => {
    const call: McpCall = async (tool, args) => {
      calls.push({ tool, args, token });
      if (tool === "get_desktop_state") return { text: "Desktop screenshot", imageBase64: "iVBORw0KGgo=", isError: false };
      if (tool === "list_windows") return { text: 'Found 1 windows:\n  window_id=42 pid=7 "Example - Chromium" 1050x780+0+0 app=Chromium', isError: false };
      if (tool === "get_window_state") return { text: '- [0] frame "Example - Chromium"', isError: false };
      return { text: "ok", isError: false };
    };
    return { call, close: async () => {} };
  };
  return { connect, calls };
}
async function setup(opts: Partial<Parameters<typeof createVmService>[0]> = {}) {
  const store = memoryStore(), d = fakeDocker(), m = fakeMcp(), tokenRoot = await mkdtemp(join(tmpdir(), "zetta-vm-"));
  const vm = createVmService({ store, docker, exec: d.exec, connect: m.connect, tokenRoot, allowPrivate: true, ...opts });
  return { vm, store, d, m, tokenRoot };
}

describe("vm service (fake docker + fake spacesd)", () => {
  test("the default VM is created on first start; containers are hardened, loopback-only, with a per-VM home volume", async () => {
    const { vm, store, d } = await setup();
    const a = await vm.start("alice");
    expect(a.kind).toBe("default"); expect(a.status).toBe("running");
    expect(store.rows).toHaveLength(1);
    const run = d.log.find((x) => x[0] === "run")!;
    expect(run).toContain("--cap-drop=ALL"); expect(run).toContain("127.0.0.1::3211"); expect(run).toContain(`zetta-vm-${a.id}:/home/agent`);
    expect(await vm.start("alice")).toMatchObject({ id: a.id }); // idempotent
    expect(d.log.filter((x) => x[0] === "run")).toHaveLength(1);
    await vm.closeAll();
  });
  test("each start mints a new bearer token, written to the mounted file and never reused", async () => {
    const { vm, m, tokenRoot } = await setup();
    const a = await vm.start("alice");
    await vm.act("alice", a.id, "agent", { type: "key", key: "Return" });
    const first = m.calls.at(-1)!.token;
    expect(await readFile(join(tokenRoot, a.id, "token"), "utf8")).toBe(first);
    expect((await stat(join(tokenRoot, a.id))).mode & 0o777).toBe(0o700);
    await vm.stop("alice", a.id); await vm.start("alice", a.id);
    await vm.act("alice", a.id, "agent", { type: "key", key: "Return" });
    expect(m.calls.at(-1)!.token).not.toBe(first);
    await vm.closeAll();
  });
  test("stop keeps the container and volume (restart reuses them); remove destroys both", async () => {
    const { vm, d } = await setup();
    const a = await vm.start("alice"); const name = `zetta-vm-${a.id}`;
    await vm.stop("alice", a.id);
    expect(d.containers.get(name)).toBe("exited"); expect(d.volumes.has(name)).toBe(true);
    expect((await vm.list("alice"))[0]!.status).toBe("stopped");
    await vm.start("alice", a.id);
    expect(d.log.filter((x) => x[0] === "run")).toHaveLength(1); // restarted, not recreated
    // a new image: the container is recreated on the next start, the home volume is kept
    await vm.stop("alice", a.id); d.image.current = "sha256:v2"; await vm.start("alice", a.id);
    expect(d.log.filter((x) => x[0] === "run")).toHaveLength(2); expect(d.volumes.has(name)).toBe(true);
    await vm.remove("alice", a.id);
    expect(d.containers.has(name)).toBe(false); expect(d.volumes.has(name)).toBe(false);
    expect(await vm.list("alice")).toHaveLength(0);
  });
  test("owner isolation: another user's VM id is NOT_FOUND for every operation", async () => {
    const { vm } = await setup();
    const a = await vm.start("alice");
    expect(await code(vm.start("bob", a.id))).toBe("NOT_FOUND");
    expect(await code(vm.act("bob", a.id, "user", { type: "key", key: "x" }))).toBe("NOT_FOUND");
    expect(await code(vm.screenshot("bob", a.id))).toBe("NOT_FOUND");
    expect(await code(vm.remove("bob", a.id))).toBe("NOT_FOUND");
    expect(() => vm.takeover("bob", a.id, true)).toThrow(ComputerError);
    await vm.closeAll();
  });
  test("caps: VMs per user (default included) and running VMs per user / in total", async () => {
    const { vm } = await setup({ maxPerUser: 2, maxRunningPerUser: 1, maxRunning: 2 });
    const extra = await vm.create("alice", { name: "Bank", purpose: "statements", botId: null });
    expect(extra.kind).toBe("extra");
    expect(await code(vm.create("alice", { name: "Third" }))).toBe("LIMIT");
    expect(await code(vm.create("alice", { name: "../etc" }))).toBe("INVALID");
    await vm.start("alice");
    expect(await code(vm.start("alice", extra.id))).toBe("LIMIT");
    await vm.start("bob");
    expect(await code(vm.start("carol"))).toBe("LIMIT");
    await vm.closeAll();
  });
  test("takeover: agents are refused while a person holds control; epoch guards stale turns", async () => {
    const { vm } = await setup();
    const { id } = await vm.start("u"); const epoch = vm.epochOf("u", id);
    vm.takeover("u", id, true);
    expect(await code(vm.act("u", id, "agent", { type: "key", key: "Return" }))).toBe("HUMAN_IN_CONTROL");
    expect(await code(vm.act("u", id, "user", { type: "key", key: "Return" }))).toBe("ok");
    vm.takeover("u", id, false);
    expect(await code(vm.act("u", id, "agent", { type: "key", key: "Return" }, { epoch }))).toBe("STALE_CONTROL");
    expect(() => vm.takeover("u", id, true, "human")).toThrow();
    await vm.closeAll();
  });
  test("actions map to foreground cua-driver input; navigate checks the address; read walks the browser window", async () => {
    const { vm, m } = await setup({ allowPrivate: false });
    const { id } = await vm.start("u");
    await vm.act("u", id, "agent", { type: "click", x: 10.4, y: 20 });
    expect(m.calls.at(-1)).toMatchObject({ tool: "click", args: { x: 10, y: 20, scope: "desktop", delivery_mode: "foreground" } });
    await vm.act("u", id, "agent", { type: "key", key: "ctrl+t" });
    expect(m.calls.at(-1)).toMatchObject({ tool: "hotkey", args: { keys: ["ctrl", "t"] } });
    expect(await code(vm.act("u", id, "agent", { type: "launch", app: "chromium; rm -rf /" }))).toBe("INVALID");
    expect(await code(vm.act("u", id, "agent", { type: "navigate", url: "file:///etc/passwd" }))).toBe("BLOCKED_URL");
    expect(await code(vm.act("u", id, "agent", { type: "navigate", url: "http://127.0.0.1:3211/" }))).toBe("BLOCKED_URL");
    expect(await vm.screenshot("u", id)).toBe("iVBORw0KGgo=");
    expect(await vm.read("u", id)).toContain("Example - Chromium");
    expect(m.calls.find((c) => c.tool === "get_window_state")!.args).toMatchObject({ pid: 7, window_id: 42, include_screenshot: false });
    await vm.closeAll();
  });
  test("VNC: a password file per start, one-time tickets bound to owner and VM, and viewers keep the VM from idling out", async () => {
    const { vm, d, tokenRoot } = await setup({ idleMs: 0 });
    const { id } = await vm.start("u");
    expect(await readFile(join(tokenRoot, id, "vncpass"), "utf8")).toMatch(/^[A-Za-z0-9]{8}\n$/);
    expect(d.log.find((x) => x[0] === "run")).toContain("127.0.0.1::5900");
    expect(() => vm.vncTicket("eve", id)).toThrow(ComputerError);
    const t = vm.vncTicket("u", id);
    expect(() => vm.vncViewer(t, crypto.randomUUID())).toThrow(ComputerError); // wrong VM burns the ticket
    const t2 = vm.vncTicket("u", id);
    const viewer = vm.vncViewer(t2, id);
    expect(viewer).toMatchObject({ userId: "u", port: 41234 }); expect(viewer.password).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(() => vm.vncViewer(t2, id)).toThrow(ComputerError); // one use
    viewer.release(); viewer.release();
    await vm.closeAll();
  });
  test("sweep stops leftover VM containers and marks rows stopped", async () => {
    const { vm, store, d } = await setup();
    const { id } = await vm.start("u");
    const fresh = createVmService({ store, docker, exec: d.exec, connect: fakeMcp().connect, tokenRoot: "/tmp/unused" });
    expect(await fresh.sweep()).toBe(1);
    expect(d.containers.get(`zetta-vm-${id}`)).toBe("exited"); expect(store.rows[0]!.status).toBe("stopped");
    await vm.closeAll(); await fresh.closeAll();
  });
  test("docker args: optional runtime and network", () => {
    const args = vmDockerArgs({ ...docker, runtime: "runsc", network: "zetta-vm" }, { id: "x", tokenFile: "/t/token", vncFile: "/t/vncpass" });
    expect(args.join(" ")).toContain("--runtime runsc"); expect(args.join(" ")).toContain("--network zetta-vm"); expect(args).toContain("/t/token:/run/zetta/token:ro"); expect(args).toContain("/t/vncpass:/run/zetta/vncpass:ro"); expect(args).toContain("127.0.0.1::5900");
  });
});

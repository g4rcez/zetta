import { uuidv7 } from "@zetta/core/uuid";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NavigationError } from "./cdp";
import { ComputerError } from "./service";
import {
  compactTree,
  createVmService,
  formatRead,
  vmDockerArgs,
  vmDriversFrom,
  vmOsFrom,
  type VmDocker,
  type McpCall,
  type VmExec,
  type VmRow,
  type VmStore,
} from "./vm";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e as ComputerError).code,
  );
const docker: VmDocker = {
  bin: "docker",
  image: "zetta-desktop:latest",
  memory: "2g",
  cpus: "2",
  pids: 1024,
  shm: "1g",
};

function memoryStore(): VmStore & { rows: VmRow[] } {
  const rows: VmRow[] = [];
  const row = (userId: string, v: Partial<VmRow>): VmRow => ({
    id: uuidv7(),
    ownerUserId: userId,
    name: "Default",
    kind: "default",
    target: "vm",
    driver: "cua",
    os: "debian",
    createdByBotId: null,
    purpose: null,
    status: "stopped",
    createdAt: new Date(),
    lastStartedAt: null,
    deletedAt: null,
    endpoint: null,
    connectionId: null,
    ...v,
  });
  const live = (u: string) => rows.filter((r) => r.ownerUserId === u && r.status !== "deleted");
  return {
    rows,
    list: async (u) => live(u),
    get: async (u, id) => live(u).find((r) => r.id === id),
    ensureDefault: async (u) => {
      const hit = live(u).find((r) => r.kind === "default");
      if (hit) return hit;
      const r = row(u, {});
      rows.push(r);
      return r;
    },
    create: async (u, v) => {
      const r = row(u, {
        kind: "extra",
        name: v.name,
        purpose: v.purpose ?? null,
        createdByBotId: v.botId ?? null,
        ...(v.target ? { target: v.target } : {}),
        ...(v.driver ? { driver: v.driver } : {}),
        ...(v.os ? { os: v.os } : {}),
        endpoint: v.endpoint ?? null,
        connectionId: v.connectionId ?? null,
      });
      rows.push(r);
      return r;
    },
    setDriver: async (_u, id, driver) => {
      rows.find((x) => x.id === id)!.driver = driver;
    },
    count: async (u) => live(u).length,
    setStatus: async (id, status) => {
      const r = rows.find((x) => x.id === id)!;
      r.status = status;
    },
    resetRunning: async () => {
      for (const r of rows) if (r.status === "running") r.status = "stopped";
    },
  };
}
/** What agent-desktop prints for the few commands a start needs (envelopes as recorded from agent-desktop 1.1.0 on the VM image). */
const agentDesktopReply = (command: string) =>
  JSON.stringify({
    version: "2.6",
    ok: true,
    command,
    data:
      command === "list-windows"
        ? [{ id: "w-1", app_name: "chromium", title: "Example - Chromium", is_focused: true }]
        : { permissions: { accessibility: { state: "granted" } } },
  });
/** Fake container CLI: tracks containers/volumes by name; `docker start` only works for an existing (stopped) container. */
function fakeDocker() {
  const containers = new Map<string, "running" | "exited">();
  const volumes = new Set<string>();
  const log: string[][] = [];
  const images = new Map<string, string>();
  const image = { current: "sha256:v1" };
  const exec: VmExec = async (args) => {
    log.push(args);
    const [cmd] = args;
    const name = args[args.length - 1]!;
    if (cmd === "run") {
      const n = args[args.indexOf("--name") + 1]!;
      containers.set(n, "running");
      images.set(n, image.current);
      volumes.add(n);
      return { code: 0, stdout: "id\n" };
    }
    if (cmd === "start") {
      if (!containers.has(name)) return { code: 1, stdout: "" };
      containers.set(name, "running");
      return { code: 0, stdout: "" };
    }
    if (cmd === "stop") {
      if (containers.has(name)) containers.set(name, "exited");
      return { code: 0, stdout: "" };
    }
    if (cmd === "rm") {
      containers.delete(name);
      return { code: 0, stdout: "" };
    }
    if (cmd === "volume") {
      volumes.delete(name);
      return { code: 0, stdout: "" };
    }
    if (cmd === "port") return { code: 0, stdout: "127.0.0.1:41234\n" };
    if (cmd === "exec")
      return {
        code: 0,
        stdout: args[2] === "zetta-agent-desktop" ? agentDesktopReply(args[3]!) : "",
      };
    if (cmd === "ps") return { code: 0, stdout: [...containers.keys()].join("\n") };
    if (cmd === "restart") {
      if (!containers.has(name)) return { code: 1, stdout: "" };
      containers.set(name, "running");
      return { code: 0, stdout: "" };
    }
    if (cmd === "inspect")
      return containers.has(name)
        ? { code: 0, stdout: `${images.get(name)} ${containers.get(name) === "running"}\n` }
        : { code: 1, stdout: "" };
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
      if (tool === "get_desktop_state")
        return { text: "Desktop screenshot", imageBase64: "iVBORw0KGgo=", isError: false };
      if (tool === "list_windows")
        return {
          text: 'Found 1 windows:\n  window_id=42 pid=7 "Example - Chromium" 1050x780+0+0 app=Chromium',
          isError: false,
        };
      if (tool === "get_window_state")
        return { text: '- [0] frame "Example - Chromium"', isError: false };
      return { text: "ok", isError: false };
    };
    return { call, close: async () => {} };
  };
  return { connect, calls };
}
async function setup(opts: Partial<Parameters<typeof createVmService>[0]> = {}) {
  const store = memoryStore(),
    d = fakeDocker(),
    m = fakeMcp(),
    tokenRoot = await mkdtemp(join(tmpdir(), "zetta-vm-"));
  const vm = createVmService({
    store,
    docker,
    exec: d.exec,
    connect: m.connect,
    tokenRoot,
    allowPrivate: true,
    links: async () => {
      throw new Error("no DevTools in this test");
    },
    navigate: async () => {
      throw new Error("no DevTools in this test");
    },
    ...opts,
  });
  return { vm, store, d, m, tokenRoot };
}

describe("vm service (fake docker + fake spacesd)", () => {
  test("the default VM is created on first start; containers are hardened, loopback-only, with a per-VM home volume", async () => {
    const { vm, store, d } = await setup();
    const a = await vm.start("alice");
    expect(a.kind).toBe("default");
    expect(a.status).toBe("running");
    expect(store.rows).toHaveLength(1);
    const run = d.log.find((x) => x[0] === "run")!;
    expect(run).toContain("--cap-drop=ALL");
    expect(run).toContain("127.0.0.1::3211");
    expect(run).toContain(`zetta-vm-${a.id}:/home/agent`);
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
    if (process.platform !== "win32")
      expect((await stat(join(tokenRoot, a.id))).mode & 0o777).toBe(0o700); // Windows has no mode bits
    await vm.stop("alice", a.id);
    await vm.start("alice", a.id);
    await vm.act("alice", a.id, "agent", { type: "key", key: "Return" });
    expect(m.calls.at(-1)!.token).not.toBe(first);
    await vm.closeAll();
  });
  test("stop keeps the container and volume (restart reuses them); remove destroys both", async () => {
    const { vm, d } = await setup();
    const a = await vm.start("alice");
    const name = `zetta-vm-${a.id}`;
    await vm.stop("alice", a.id);
    expect(d.containers.get(name)).toBe("exited");
    expect(d.volumes.has(name)).toBe(true);
    expect((await vm.list("alice"))[0]!.status).toBe("stopped");
    await vm.start("alice", a.id);
    expect(d.log.filter((x) => x[0] === "run")).toHaveLength(1); // restarted, not recreated
    // a new image: the container is recreated on the next start, the home volume is kept
    await vm.stop("alice", a.id);
    d.image.current = "sha256:v2";
    await vm.start("alice", a.id);
    expect(d.log.filter((x) => x[0] === "run")).toHaveLength(2);
    expect(d.volumes.has(name)).toBe(true);
    await vm.remove("alice", a.id);
    expect(d.containers.has(name)).toBe(false);
    expect(d.volumes.has(name)).toBe(false);
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
  test("a computer has a target and a driver; only allowed ones are accepted, and a running computer keeps its driver", async () => {
    const { vm, d, m } = await setup({ vmDrivers: ["cua", "agent-desktop"] });
    const made = await vm.create("alice", { name: "Work", driver: "agent-desktop" });
    expect([made.target, made.driver]).toEqual(["vm", "agent-desktop"]);
    expect((await vm.start("alice")).driver).toBe("cua");
    // An agent-desktop computer is driven by commands run in its container; spacesd is never contacted.
    const [logged, spacesd] = [d.log.length, m.calls.length];
    expect((await vm.start("alice", made.id)).driver).toBe("agent-desktop");
    expect(d.log.slice(logged).some((a) => a[0] === "exec" && a[2] === "zetta-agent-desktop")).toBe(
      true,
    );
    expect(m.calls.length).toBe(spacesd);
    await vm.stop("alice", made.id);
    expect(vm.options().targets).toEqual({ vm: ["cua", "agent-desktop"], local: [], cua: [] });
    // The server's own desktop is not offered yet.
    expect(await code(vm.create("alice", { name: "Mine", target: "local" }))).toBe("UNSUPPORTED");
    const def = (await vm.list("alice")).find((x) => x.kind === "default")!;
    expect(await code(vm.setDriver("alice", def.id, "agent-desktop"))).toBe("LIMIT"); // running
    expect(await code(vm.setDriver("bob", def.id, "cua"))).toBe("NOT_FOUND");
    await vm.stop("alice", def.id);
    await vm.setDriver("alice", def.id, "agent-desktop");
    expect((await vm.list("alice")).find((x) => x.id === def.id)!.driver).toBe("agent-desktop");
    await vm.closeAll();
  });
  test("the operator's system list: known names only, debian when empty", () => {
    expect(vmOsFrom(undefined)).toEqual(["debian"]);
    expect(vmOsFrom("windows,nope")).toEqual(["debian"]);
    expect(vmOsFrom("ubuntu, debian,ubuntu")).toEqual(["ubuntu", "debian"]);
  });
  test("a computer runs the image of its system, and a system the operator did not offer is refused", async () => {
    const { vm, d } = await setup({ vmOs: ["debian", "ubuntu"] });
    const ubuntu = await vm.create("alice", { name: "Ubuntu box", os: "ubuntu" });
    expect(ubuntu.os).toBe("ubuntu");
    await vm.start("alice", ubuntu.id);
    const run = d.log.find((a) => a[0] === "run" && a.includes(`zetta-vm-${ubuntu.id}`))!;
    expect(run.at(-1)).toBe("zetta-desktop-ubuntu:latest");
    const debian = (await vm.start("alice")).id;
    expect(d.log.find((a) => a[0] === "run" && a.includes(`zetta-vm-${debian}`))!.at(-1)).toBe(
      "zetta-desktop:latest",
    );
    await vm.closeAll();

    const only = await setup();
    expect(await code(only.vm.create("alice", { name: "Ubuntu box", os: "ubuntu" }))).toBe(
      "UNSUPPORTED",
    );
  });
  test("the list a person picks from has every system; Windows and macOS say why they are not available", async () => {
    const { vm } = await setup({ vmOs: ["debian", "ubuntu"] });
    expect(vm.options().os.map((o) => [o.id, o.family, o.available])).toEqual([
      ["debian", "linux", true],
      ["ubuntu", "linux", true],
      ["windows", "windows", false],
      ["macos", "macos", false],
    ]);
    expect(vm.options().os.find((o) => o.id === "windows")!.note).toContain("licence");
    expect((await setup()).vm.options().os.find((o) => o.id === "ubuntu")!.available).toBe(false);
  });
  test("a system without a browser starts without waiting for one and refuses browser actions", async () => {
    const { vm, m } = await setup({ vmOs: ["debian", "ubuntu"] });
    const ubuntu = await vm.create("alice", { name: "Ubuntu box", os: "ubuntu" });
    const before = m.calls.length;
    await vm.start("alice", ubuntu.id);
    expect(m.calls.slice(before).filter((c) => c.tool === "list_windows")).toEqual([]);
    expect(
      await code(
        vm.act("alice", ubuntu.id, "agent", { type: "navigate", url: "https://example.com" }),
      ),
    ).toBe("UNSUPPORTED");
    expect(await code(vm.fillCredential("alice", ubuntu.id, "password", async () => "x"))).toBe(
      "UNSUPPORTED",
    );
    await vm.act("alice", ubuntu.id, "agent", { type: "key", key: "ctrl+l" }); // other input still works
    await vm.closeAll();
  });
  test("the operator's driver list: known names only, cua when empty", () => {
    expect(vmDriversFrom(undefined)).toEqual(["cua"]);
    expect(vmDriversFrom("")).toEqual(["cua"]);
    expect(vmDriversFrom("agent-desktop, cua,agent-desktop,nope")).toEqual([
      "agent-desktop",
      "cua",
    ]);
  });
  test("a driver the operator did not allow is refused", async () => {
    const { vm } = await setup();
    expect(await code(vm.create("alice", { name: "Work", driver: "agent-desktop" }))).toBe(
      "UNSUPPORTED",
    );
    const def = await vm.start("alice");
    await vm.stop("alice", def.id);
    expect(await code(vm.setDriver("alice", def.id, "agent-desktop"))).toBe("UNSUPPORTED");
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
    const { id } = await vm.start("u");
    const epoch = vm.epochOf("u", id);
    vm.takeover("u", id, true);
    expect(await code(vm.act("u", id, "agent", { type: "key", key: "Return" }))).toBe(
      "HUMAN_IN_CONTROL",
    );
    expect(await code(vm.act("u", id, "user", { type: "key", key: "Return" }))).toBe("ok");
    vm.takeover("u", id, false);
    expect(await code(vm.act("u", id, "agent", { type: "key", key: "Return" }, { epoch }))).toBe(
      "STALE_CONTROL",
    );
    expect(() => vm.takeover("u", id, true, "human")).toThrow();
    await vm.closeAll();
  });
  test("actions map to foreground cua-driver input; navigate checks the address; read walks the browser window", async () => {
    const { vm, m } = await setup({ allowPrivate: false });
    const { id } = await vm.start("u");
    await vm.act("u", id, "agent", { type: "click", x: 10.4, y: 20 });
    expect(m.calls.at(-1)).toMatchObject({
      tool: "click",
      args: { x: 10, y: 20, scope: "desktop", delivery_mode: "foreground" },
    });
    await vm.act("u", id, "agent", { type: "key", key: "ctrl+t" });
    expect(m.calls.at(-1)).toMatchObject({ tool: "hotkey", args: { keys: ["ctrl", "t"] } });
    expect(
      await code(vm.act("u", id, "agent", { type: "launch", app: "chromium; rm -rf /" })),
    ).toBe("INVALID");
    expect(
      await code(vm.act("u", id, "agent", { type: "navigate", url: "file:///etc/passwd" })),
    ).toBe("BLOCKED_URL");
    expect(
      await code(vm.act("u", id, "agent", { type: "navigate", url: "http://127.0.0.1:3211/" })),
    ).toBe("BLOCKED_URL");
    expect(await vm.screenshot("u", id)).toBe("iVBORw0KGgo=");
    expect(await vm.read("u", id)).toContain("Example - Chromium");
    expect(m.calls.find((c) => c.tool === "get_window_state")!.args).toMatchObject({
      pid: 7,
      window_id: 42,
      include_screenshot: false,
    });
    await vm.closeAll();
  });
  test("click_element clicks the center of element [n] from the last read; a shifted page is matched by label; gone is NO_ELEMENT", async () => {
    const tree = [
      '- [0] frame "Shop - Chromium"',
      '  - [5] button "Add to cart"',
      '  - [6] link "Checkout"',
    ].join("\n");
    let elements = [
      {
        element_index: 5,
        role: "button",
        label: "Add to cart",
        frame: { x: 100, y: 200, w: 40, h: 20 },
      },
      {
        element_index: 6,
        role: "link",
        label: "Checkout",
        frame: { x: 300, y: 400, w: 60, h: 10 },
      },
    ];
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const connect = async () => ({
      call: (async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args });
        if (tool === "list_windows")
          return { text: 'window_id=42 pid=7 "Shop - Chromium" 1280x773+0+27', isError: false };
        if (tool === "get_window_state")
          return args.tree_format === "elements"
            ? {
                text: "",
                isError: false,
                structured: {
                  elements,
                  coordinate_frame: "window",
                  window_bounds: { x: 0, y: 27, height: 773 },
                },
              }
            : { text: tree, isError: false };
        return { text: "ok", isError: false };
      }) as McpCall,
      close: async () => {},
    });
    const { vm } = await setup({ connect });
    const { id } = await vm.start("u");
    const screen = await vm.read("u", id);
    expect(screen).toContain('[5] button "Add to cart"');
    expect(screen).toContain('[6] link "Checkout"');
    await vm.act("u", id, "agent", { type: "click_element", n: 5 });
    // frames are screen pixels: the center of the frame
    expect(calls.at(-1)).toMatchObject({ tool: "click", args: { x: 120, y: 210 } });
    // the page shifted: index 5 now holds another element, the label the bot saw wins
    elements = [
      { element_index: 5, role: "button", label: "Sign in", frame: { x: 0, y: 30, w: 10, h: 10 } },
      {
        element_index: 7,
        role: "button",
        label: "Add to cart",
        frame: { x: 500, y: 600, w: 20, h: 20 },
      },
    ];
    await vm.act("u", id, "agent", { type: "click_element", n: 5 });
    expect(calls.at(-1)).toMatchObject({ tool: "click", args: { x: 510, y: 610 } });
    elements = [];
    expect(await code(vm.act("u", id, "agent", { type: "click_element", n: 6 }))).toBe(
      "NO_ELEMENT",
    );
    // the window is looked up once and cached across actions
    expect(calls.filter((c) => c.tool === "list_windows").length).toBeLessThanOrEqual(3);
    await vm.closeAll();
  });
  test("a slow spacesd call is SLOW, not a dropped connection: the session survives", async () => {
    let slow = true;
    const connect = async () => ({
      call: (async (tool: string) => {
        if (tool === "list_windows")
          return { text: 'window_id=42 pid=7 "X - Chromium"', isError: false };
        if (tool === "click" && slow) throw new ComputerError("SLOW");
        return { text: "ok", isError: false };
      }) as McpCall,
      close: async () => {},
    });
    const { vm } = await setup({ connect });
    const { id } = await vm.start("u");
    expect(await code(vm.act("u", id, "agent", { type: "click", x: 1, y: 1 }))).toBe("SLOW");
    slow = false;
    expect(await code(vm.act("u", id, "agent", { type: "click", x: 1, y: 1 }))).toBe("ok");
    await vm.closeAll();
  });
  test("VNC: a password file per start, one-time tickets bound to owner and VM, and viewers keep the VM from idling out", async () => {
    const { vm, d, tokenRoot } = await setup({ idleMs: 0 });
    const { id } = await vm.start("u");
    expect(await readFile(join(tokenRoot, id, "vncpass"), "utf8")).toMatch(/^[A-Za-z0-9]{8}\n$/);
    expect(d.log.find((x) => x[0] === "run")).toContain("127.0.0.1::5900");
    expect(() => vm.vncTicket("eve", id)).toThrow(ComputerError);
    const t = vm.vncTicket("u", id);
    expect(() => vm.vncViewer(t, uuidv7())).toThrow(ComputerError); // wrong VM burns the ticket
    const t2 = vm.vncTicket("u", id);
    const viewer = vm.vncViewer(t2, id);
    expect(viewer).toMatchObject({ userId: "u", port: 41234 });
    expect(viewer.password).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(() => vm.vncViewer(t2, id)).toThrow(ComputerError); // one use
    viewer.release();
    viewer.release();
    await vm.closeAll();
  });
  test("a VM left running by another process (or before a hot reload) is reattached with its token, never restarted under it", async () => {
    const { vm, store, d, tokenRoot } = await setup();
    const { id } = await vm.start("u");
    const token = await readFile(join(tokenRoot, id, "token"), "utf8");
    const m2 = fakeMcp(),
      fresh = createVmService({ store, docker, exec: d.exec, connect: m2.connect, tokenRoot });
    await fresh.start("u", id);
    await fresh.act("u", id, "agent", { type: "key", key: "Return" });
    expect(d.log.filter((x) => x[0] === "restart")).toHaveLength(0);
    expect(m2.calls.at(-1)!.token).toBe(token);
    expect(await readFile(join(tokenRoot, id, "token"), "utf8")).toBe(token);
    vm.detach();
    await fresh.closeAll();
  });
  test("when the token on disk no longer works, the running VM is restarted with a new token and VNC password", async () => {
    const { vm, store, d, tokenRoot } = await setup();
    const { id } = await vm.start("u");
    const token = await readFile(join(tokenRoot, id, "token"), "utf8");
    const m2 = fakeMcp(),
      fresh = createVmService({
        store,
        docker,
        exec: d.exec,
        connect: (port, t, attempts) =>
          attempts ? Promise.reject(new Error("401")) : m2.connect(port, t),
        tokenRoot,
      });
    await fresh.start("u", id);
    expect(d.log.filter((x) => x[0] === "restart")).toHaveLength(1);
    expect(await readFile(join(tokenRoot, id, "token"), "utf8")).not.toBe(token);
    vm.detach();
    await fresh.closeAll();
  });
  test("a dropped transport surfaces as DISCONNECTED and the next start reconnects", async () => {
    const { vm, store, d, tokenRoot } = await setup();
    let dead = false;
    const m = fakeMcp(),
      flaky = createVmService({
        store,
        docker,
        exec: d.exec,
        tokenRoot,
        allowPrivate: true,
        connect: async (port, t) => {
          const c = await m.connect(port, t);
          return {
            ...c,
            call: (tool, args) =>
              dead ? Promise.reject(new Error("fetch failed")) : c.call(tool, args),
          };
        },
      });
    const { id } = await flaky.start("u");
    dead = true;
    expect(await code(flaky.act("u", id, "agent", { type: "key", key: "Return" }))).toBe(
      "DISCONNECTED",
    );
    expect(await code(flaky.screenshot("u", id))).toBe("NOT_FOUND");
    dead = false;
    await flaky.start("u", id);
    expect(await code(flaky.act("u", id, "agent", { type: "key", key: "Return" }))).toBe("ok");
    vm.detach();
    await flaky.closeAll();
  });
  test("sweep keeps a VM that was used moments ago (another process is driving it)", async () => {
    const { vm, store, d, tokenRoot } = await setup();
    const { id } = await vm.start("u");
    const fresh = createVmService({
      store,
      docker,
      exec: d.exec,
      connect: fakeMcp().connect,
      tokenRoot,
    });
    expect(await fresh.sweep()).toBe(0);
    expect(d.containers.get(`zetta-vm-${id}`)).toBe("running");
    vm.detach();
    await fresh.closeAll();
  });
  test("paste types into the VM with xdotool; keyboard layouts are an allowlist applied with setxkbmap", async () => {
    const { vm, d } = await setup();
    const { id } = await vm.start("u");
    await vm.paste("u", id, "echo 'hi; rm -rf /'");
    expect(d.log.at(-1)).toEqual([
      "exec",
      `zetta-vm-${id}`,
      "xdotool",
      "type",
      "--clearmodifiers",
      "--delay",
      "6",
      "--",
      "echo 'hi; rm -rf /'",
    ]);
    expect(await vm.keyboard("u", id, "us:intl")).toBe("us:intl");
    expect(d.log.at(-1)).toEqual([
      "exec",
      `zetta-vm-${id}`,
      "setxkbmap",
      "-layout",
      "us",
      "-variant",
      "intl",
    ]);
    expect((await vm.list("u"))[0]!.keyboard).toBe("us:intl");
    expect(await code(vm.keyboard("u", id, "-rules evil"))).toBe("INVALID");
    expect(await code(vm.paste("eve", id, "x"))).toBe("NOT_FOUND");
    await vm.closeAll();
  });
  test("sweep stops leftover VM containers and marks rows stopped", async () => {
    const { vm, store, d } = await setup();
    const { id } = await vm.start("u");
    const fresh = createVmService({
      store,
      docker,
      exec: d.exec,
      connect: fakeMcp().connect,
      tokenRoot: "/tmp/unused",
    });
    expect(await fresh.sweep()).toBe(1);
    expect(d.containers.get(`zetta-vm-${id}`)).toBe("exited");
    expect(store.rows[0]!.status).toBe("stopped");
    await vm.closeAll();
    await fresh.closeAll();
  });
  test("read turns the accessibility tree into page text: empty containers, actions and repeated labels are dropped", () => {
    const tree = [
      '- [0] frame "Neovim - Chromium" [actions=[doDefault]]',
      '  - [1] panel "\uFFFC\uFFFC" [actions=[doDefault]]',
      '    - button = "Forward" (disabled)',
      '      - [2] section "\uFFFC" (description "Open inbox") [actions=[click]]',
      '        - [3] link "Open inbox" [actions=[jump]]',
      '          - static = "Open inbox"',
      '      - [4] heading "Kulala v7" [actions=[click]]',
      '        - static = "Kulala v7"',
      '      - static = "Hello fellow Neovimmers"',
    ].join("\n");
    expect(compactTree(tree).split("\n")).toEqual([
      'frame "Neovim - Chromium"',
      'button "Forward"',
      "Open inbox",
      'heading "Kulala v7"',
      "Hello fellow Neovimmers",
    ]);
  });
  test("docker args: optional runtime and network", () => {
    const args = vmDockerArgs(
      { ...docker, runtime: "runsc", network: "zetta-vm" },
      { id: "x", tokenFile: "/t/token", vncFile: "/t/vncpass" },
    );
    expect(args.join(" ")).toContain("--runtime runsc");
    expect(args.join(" ")).toContain("--network zetta-vm");
    expect(args).toContain("/t/token:/run/zetta/token:ro");
    expect(args).toContain("/t/vncpass:/run/zetta/vncpass:ro");
    expect(args).toContain("127.0.0.1::5900");
    expect(args).toContain("127.0.0.1::9222");
    expect(args).not.toContain("9222:9222");
  });
});

describe("page address and links in a read", () => {
  const tree = ['- [0] frame "r/neovim - Chromium"', '  - [3] link "Inspect your LSP config"'].join(
    "\n",
  );
  const connect = async () => ({
    call: (async (tool: string) => {
      if (tool === "list_windows")
        return { text: 'window_id=42 pid=7 "r/neovim - Chromium" 1280x773+0+27', isError: false };
      if (tool === "get_window_state") return { text: tree, isError: false };
      return { text: "ok", isError: false };
    }) as McpCall,
    close: async () => {},
  });
  const page = {
    url: "https://www.reddit.com/r/neovim/top/?t=day",
    links: [
      {
        text: "Inspect your LSP config",
        href: "https://www.reddit.com/r/neovim/comments/1xi0kzm/inspect_debug_optimize_your_lsp_config_using/",
      },
      { text: "", href: "https://www.reddit.com/user/someone/" },
    ],
  };
  test("an explicit read shows the address and where each link goes, read from the published DevTools port", async () => {
    const ports: number[] = [];
    const { vm } = await setup({
      connect,
      links: async (port) => {
        ports.push(port);
        return page;
      },
    });
    const { id } = await vm.start("u");
    expect(await vm.read("u", id)).toBe(
      'Window "r/neovim - Chromium" (click_element{n} clicks [n]):\nURL: https://www.reddit.com/r/neovim/top/?t=day\nframe "r/neovim - Chromium"\n[3] link "Inspect your LSP config"\nLinks on the page (text -> address):\n- Inspect your LSP config -> https://www.reddit.com/r/neovim/comments/1xi0kzm/inspect_debug_optimize_your_lsp_config_using/\n- (no text) -> https://www.reddit.com/user/someone/',
    );
    expect(ports).toEqual([41234]);
    await vm.closeAll();
  });
  test("a read right after an action shows the address but no link list", async () => {
    const { vm } = await setup({ connect, links: async () => page });
    const { id } = await vm.start("u");
    const screen = await vm.read("u", id, { settle: true });
    expect(screen).toContain("URL: https://www.reddit.com/r/neovim/top/?t=day");
    expect(screen).not.toContain("Links on the page");
    await vm.closeAll();
  });
  test("a VM without DevTools still reads its screen, without an address", async () => {
    const { vm } = await setup({ connect });
    const { id } = await vm.start("u");
    expect(await vm.read("u", id)).toBe(
      'Window "r/neovim - Chromium" (click_element{n} clicks [n]):\nframe "r/neovim - Chromium"\n[3] link "Inspect your LSP config"',
    );
    await vm.closeAll();
  });
});

describe("navigate over the DevTools port", () => {
  const keys = (m: { calls: { tool: string }[] }) => m.calls.map((c) => c.tool);
  test("the address opens through the published port, nothing is typed, and the answer names the page the tab is on", async () => {
    const seen: [number, string][] = [];
    const { vm, m } = await setup({
      navigate: async (port, url) => {
        seen.push([port, url]);
        return { url: "https://old.reddit.com/r/neovim/top/?t=day", loaded: true };
      },
    });
    const { id } = await vm.start("u");
    expect(
      await vm.act("u", id, "agent", {
        type: "navigate",
        url: "https://old.reddit.com/r/neovim/top/?t=day",
      }),
    ).toMatchObject({ url: "https://old.reddit.com/r/neovim/top/?t=day", loaded: true });
    expect(seen).toEqual([[41234, "https://old.reddit.com/r/neovim/top/?t=day"]]);
    expect(keys(m)).not.toContain("type_text");
    await vm.closeAll();
  });
  test("an address the browser refuses is NAVIGATION_FAILED with the browser's error", async () => {
    const { vm } = await setup({
      navigate: async () => {
        throw new NavigationError("net::ERR_NAME_NOT_RESOLVED");
      },
    });
    const { id } = await vm.start("u");
    const e = await vm
      .act("u", id, "agent", { type: "navigate", url: "https://nowhere.example/" })
      .catch((x) => x);
    expect(e).toMatchObject({ code: "NAVIGATION_FAILED", detail: "net::ERR_NAME_NOT_RESOLVED" });
    await vm.closeAll();
  });
  test("DevTools that does not answer falls back to the address bar: ctrl+l, the address, Return", async () => {
    const { vm, m } = await setup();
    const { id } = await vm.start("u");
    await vm.act("u", id, "agent", { type: "navigate", url: "https://example.com/" });
    expect(keys(m).slice(-4)).toEqual(["bring_to_front", "hotkey", "type_text", "press_key"]);
    expect(m.calls.at(-2)).toMatchObject({
      tool: "type_text",
      args: { text: "https://example.com/" },
    });
    await vm.closeAll();
  });
  test("a blank tab is called out in a read, so the bot navigates again instead of reporting an empty page", () => {
    expect(
      formatRead("about:blank - Chromium", "frame", { url: "about:blank", links: [] }, true),
    ).toBe(
      'The browser shows an empty tab (about:blank): navigate again.\nWindow "about:blank - Chromium" (click_element{n} clicks [n]):\nURL: about:blank\nframe',
    );
    expect(formatRead("New Tab - Chromium", "frame", undefined, true)).toBe(
      'Window "New Tab - Chromium" (click_element{n} clicks [n]):\nframe',
    );
  });
});

describe("remote Cua computer (a spacesd on another machine)", () => {
  const TOKEN = "fake-remote-bearer-token-123";
  const ENDPOINT = "https://93.184.216.34";
  /** The sealed-token store: what the connections store does in production. */
  function fakeSecrets() {
    const kept = new Map<string, { userId: string; secret: string; revoked: boolean }>();
    return {
      kept,
      create: async (userId: string, _label: string, secret: string) => {
        const id = uuidv7();
        kept.set(id, { userId, secret, revoked: false });
        return id;
      },
      read: async (userId: string, id: string) => {
        const k = kept.get(id);
        if (!k || k.userId !== userId || k.revoked) throw new ComputerError("REVOKED");
        return k.secret;
      },
      revoke: async (_userId: string, id: string) => {
        kept.get(id)!.revoked = true;
      },
    };
  }
  async function remote(opts: Partial<Parameters<typeof createVmService>[0]> = {}) {
    const secrets = fakeSecrets();
    const m = fakeMcp();
    const connected: { endpoint: string; token: string; closed: boolean }[] = [];
    const base = await setup({
      allowPrivate: false,
      secrets,
      connectRemote: async (endpoint, token) => {
        const entry = { endpoint, token, closed: false };
        connected.push(entry);
        const session = await m.connect(0, token);
        return {
          call: session.call,
          close: async () => {
            entry.closed = true;
          },
        };
      },
      ...opts,
    });
    return { ...base, secrets, connected, calls: m.calls };
  }

  test("the token is sealed at once; the row and the view hold the address and an id, never the token", async () => {
    const { vm, store, secrets } = await remote();
    const made = await vm.createRemote("alice", {
      name: "Office Mac",
      endpoint: ENDPOINT,
      token: TOKEN,
    });
    expect(made).toMatchObject({
      name: "Office Mac",
      target: "cua",
      endpoint: ENDPOINT,
      status: "stopped",
    });
    expect(JSON.stringify(made)).not.toContain(TOKEN);
    expect(JSON.stringify(store.rows)).not.toContain(TOKEN);
    expect([...secrets.kept.values()].map((k) => k.secret)).toEqual([TOKEN]);
    expect(vm.options().targets.cua).toEqual(["cua"]);
  });

  test("starting connects with the stored token, touches no container, and acting goes through that connection", async () => {
    const { vm, d, connected, calls } = await remote();
    const made = await vm.createRemote("alice", {
      name: "Office Mac",
      endpoint: ENDPOINT,
      token: TOKEN,
    });
    const logged = d.log.length;
    expect((await vm.start("alice", made.id)).status).toBe("running");
    expect(connected).toEqual([{ endpoint: ENDPOINT, token: TOKEN, closed: false }]);
    await vm.act("alice", made.id, "agent", { type: "key", key: "Return" });
    expect(calls.some((c) => c.tool === "press_key" && c.token === TOKEN)).toBe(true);
    expect(await vm.screenshot("alice", made.id)).toBe("iVBORw0KGgo=");
    await vm.stop("alice", made.id);
    expect(connected[0]!.closed).toBe(true);
    expect((await vm.list("alice")).find((x) => x.id === made.id)!.status).toBe("stopped");
    expect(d.log.length).toBe(logged);
  });

  test("no browser is assumed: navigate, paste, keyboard and VNC are not offered", async () => {
    const { vm } = await remote();
    const made = await vm.createRemote("alice", {
      name: "Office Mac",
      endpoint: ENDPOINT,
      token: TOKEN,
    });
    await vm.start("alice", made.id);
    expect(
      await code(
        vm.act("alice", made.id, "agent", { type: "navigate", url: "https://example.com" }),
      ),
    ).toBe("UNSUPPORTED");
    expect(await code(vm.paste("alice", made.id, "hello"))).toBe("UNSUPPORTED");
    expect(await code(vm.keyboard("alice", made.id, "us"))).toBe("UNSUPPORTED");
    expect(() => vm.vncTicket("alice", made.id)).toThrow();
    await vm.closeAll();
  });

  test("only https, with no credentials, path or query, and not a private address unless the operator allows it", async () => {
    const { vm } = await remote();
    const add = (endpoint: string) =>
      code(vm.createRemote("alice", { name: "X", endpoint, token: TOKEN }));
    expect(await add("http://93.184.216.34")).toBe("INSECURE");
    expect(await add("https://user:pass@93.184.216.34")).toBe("INVALID");
    expect(await add("https://93.184.216.34/mcp")).toBe("INVALID");
    expect(await add("https://93.184.216.34/?token=x")).toBe("INVALID");
    expect(await add("not a url")).toBe("INVALID");
    for (const host of ["10.0.0.5", "127.0.0.1", "192.168.1.9", "169.254.169.254", "localhost"])
      expect(await add(`https://${host}`)).toBe("BLOCKED_URL");
    const lan = await remote({ allowPrivate: true });
    expect(
      await code(
        lan.vm.createRemote("alice", {
          name: "Lab",
          endpoint: "http://10.0.0.5:3211",
          token: TOKEN,
        }),
      ),
    ).toBe("ok");
  });

  test("an address that has become private since it was saved is refused at start", async () => {
    const { vm, store } = await remote();
    const made = await vm.createRemote("alice", {
      name: "Office Mac",
      endpoint: ENDPOINT,
      token: TOKEN,
    });
    store.rows.find((r) => r.id === made.id)!.endpoint = "https://10.0.0.5";
    expect(await code(vm.start("alice", made.id))).toBe("BLOCKED_URL");
  });

  test("deleting revokes the token and leaves Docker alone; another user cannot start or delete it", async () => {
    const { vm, d, secrets, connected } = await remote();
    const made = await vm.createRemote("alice", {
      name: "Office Mac",
      endpoint: ENDPOINT,
      token: TOKEN,
    });
    expect(await code(vm.start("bob", made.id))).toBe("NOT_FOUND");
    expect(await code(vm.remove("bob", made.id))).toBe("NOT_FOUND");
    await vm.start("alice", made.id);
    const logged = d.log.length;
    await vm.remove("alice", made.id);
    expect([...secrets.kept.values()].map((k) => k.revoked)).toEqual([true]);
    expect(connected[0]!.closed).toBe(true);
    expect(d.log.length).toBe(logged);
    expect((await vm.list("alice")).some((x) => x.id === made.id)).toBe(false);
  });

  test("without a secrets store remote computers are off, and a remote one never takes a local driver", async () => {
    const { vm } = await setup();
    expect(
      await code(vm.createRemote("alice", { name: "X", endpoint: ENDPOINT, token: TOKEN })),
    ).toBe("UNSUPPORTED");
    expect(vm.options().targets.cua).toEqual([]);
    const withSecrets = await remote();
    const made = await withSecrets.vm.createRemote("alice", {
      name: "Office Mac",
      endpoint: ENDPOINT,
      token: TOKEN,
    });
    expect(await code(withSecrets.vm.setDriver("alice", made.id, "agent-desktop"))).toBe(
      "UNSUPPORTED",
    );
  });
});

describe("this machine's own desktop (target local)", () => {
  const hostDriver = () => {
    const acts: string[] = [];
    return {
      acts,
      driver: {
        ready: async () => {},
        probe: async () => true,
        act: async (a: { type: string }) => void acts.push(a.type),
        screenshot: async () => "png",
        read: async () => ({ kind: "plain" as const, text: "Notes" }),
        fillCredential: async () => {
          throw new Error("never");
        },
      },
    };
  };
  test("a server open to the network never offers it, even with a host driver", async () => {
    const h = hostDriver();
    const { vm } = await setup({ install: "network", host: () => h.driver as never });
    expect(vm.options().targets.local).toEqual([]);
    await expect(vm.create("alice", { name: "Mine", target: "local" })).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });
  test("a local install offers it; starting it runs no container and acts on this desktop", async () => {
    const h = hostDriver();
    const { vm, d } = await setup({ install: "local", host: () => h.driver as never });
    expect(vm.options().targets.local).toEqual(["agent-desktop"]);
    const made = await vm.create("alice", { name: "Mine", target: "local" });
    const before = d.log.length;
    expect((await vm.start("alice", made.id)).status).toBe("running");
    expect(d.log.slice(before).some((x) => x[0] === "run")).toBe(false);
    await vm.act("alice", made.id, "agent", { type: "launch", app: "Notes" });
    await vm.act("alice", made.id, "agent", { type: "navigate", url: "https://example.com" });
    expect(h.acts).toEqual(["launch", "navigate"]);
    await vm.remove("alice", made.id);
    expect(d.log.slice(before).some((x) => x[0] === "rm" || x[0] === "volume")).toBe(false);
  });
  test("without a container runtime only this machine is offered, and a VM does not start", async () => {
    const h = hostDriver();
    const { vm } = await setup({ install: "local", host: () => h.driver as never, vmOn: false });
    expect(vm.options().targets.vm).toEqual([]);
    await expect(vm.create("alice", { name: "Box" })).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });
});

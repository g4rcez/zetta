import { createSerializer } from "./serial";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Database } from "@zetta/db";
import { and, asc, eq, ne } from "@zetta/db/query";
import { computerVm } from "@zetta/db/schema/features";
import { assertPublicUrl, assertWebScheme, ComputerError, type Actor } from "./service";
import type { McpCall } from "./desktop";

/**
 * Persistent Linux desktops ("VMs") for computer use. Each row in computer_vm is one container from docker/desktop (Debian, Xvfb,
 * Openbox, Chromium) running cua-spacesd; the server drives it over spacesd's Streamable-HTTP MCP on a loopback-published port with a
 * bearer token minted for that start. Home is the named volume `zetta-vm-<id>`, so sign-ins survive idle stops; delete destroys it.
 * Every user has one default VM (created on first use); extra VMs exist only after the user approves a bot's create_vm proposal.
 * Control/takeover is the same as for browser sessions: agent actions are refused while a person holds control, and an epoch
 * invalidates stale agent turns.
 */
export type VmAction =
  | { type: "click"; x: number; y: number } | { type: "type"; text: string } | { type: "key"; key: string }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number } | { type: "launch"; app: string } | { type: "navigate"; url: string };
export type VmRow = typeof computerVm.$inferSelect;
export type VmStore = {
  list(userId: string): Promise<VmRow[]>;
  get(userId: string, id: string): Promise<VmRow | undefined>;
  ensureDefault(userId: string): Promise<VmRow>;
  create(userId: string, v: { name: string; purpose?: string | null; botId?: string | null }): Promise<VmRow>;
  count(userId: string): Promise<number>;
  setStatus(id: string, status: VmRow["status"]): Promise<void>;
  resetRunning(): Promise<void>;
};
export type VmDocker = { bin: string; image: string; memory: string; cpus: string; pids: number; shm: string; runtime?: string; network?: string };
/** Runs the container CLI; injectable so tests do not need Docker. */
export type VmExec = (args: string[]) => Promise<{ code: number; stdout: string }>;
export type VmConnect = (port: number, token: string) => Promise<{ call: McpCall; close: () => Promise<void> }>;

type VSession = { id: string; userId: string; port: number; client: Awaited<ReturnType<VmConnect>>; control: "agent" | "human"; epoch: number; lastUsed: number; queue: Promise<unknown> };
const SAFE_APP = /^[A-Za-z0-9._ -]{1,60}$/;
const SAFE_NAME = /^[\p{L}\p{N} ._-]{1,60}$/u;
const container = (id: string) => `zetta-vm-${id}`;

/** `ZETTA_DESKTOP_RUNTIME=docker` turns on per-user VMs; the rest tunes the container. */
export function dockerVmConfig(env: NodeJS.ProcessEnv = process.env): VmDocker | undefined {
  if (env.ZETTA_DESKTOP_RUNTIME !== "docker") return undefined;
  return { bin: env.ZETTA_DOCKER_BIN ?? "docker", image: env.ZETTA_VM_IMAGE ?? "zetta-desktop:latest", memory: env.ZETTA_VM_MEMORY ?? "2g", cpus: env.ZETTA_VM_CPUS ?? "2", pids: Number(env.ZETTA_VM_PIDS ?? 1024), shm: env.ZETTA_VM_SHM ?? "1g", runtime: env.ZETTA_VM_RUNTIME || undefined, network: env.ZETTA_VM_NETWORK || undefined };
}
export function vmDockerArgs(d: VmDocker, o: { id: string; tokenFile: string }) {
  return ["run", "-d", "--name", container(o.id), "--label", "zetta.vm=1", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit", String(d.pids), "--memory", d.memory, "--cpus", d.cpus, "--shm-size", d.shm,
    ...(d.runtime ? ["--runtime", d.runtime] : []), ...(d.network ? ["--network", d.network] : []),
    "-v", `${container(o.id)}:/home/agent`, "-v", `${o.tokenFile}:/run/zetta/token:ro`, "-p", "127.0.0.1::3211", d.image];
}

export function createCliExec(bin: string): VmExec {
  return async (args) => {
    const p = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "ignore", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
    const stdout = await new Response(p.stdout).text();
    return { code: await p.exited, stdout };
  };
}

/** Production transport: spacesd's MCP endpoint, bearer token in a header (never in a URL), after its health check answers. */
export const connectSpacesd: VmConnect = async (port, token) => {
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${token}` };
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) { ok = await fetch(`${base}/health`, { headers }).then((r) => r.ok, () => false); if (!ok) await Bun.sleep(250); }
  if (!ok) throw new ComputerError("UNAVAILABLE");
  const c = new Client({ name: "zetta-vm", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return {
    call: async (tool, args) => {
      const r = (await c.callTool({ name: tool, arguments: args }, undefined, { timeout: 60_000 })) as { isError?: boolean; content?: { type: string; text?: string; data?: string }[] };
      return { text: (r.content ?? []).filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n"), imageBase64: r.content?.find((x) => x.type === "image")?.data, isError: Boolean(r.isError) };
    },
    close: () => c.close().catch(() => {}),
  };
};

export function createDbVmStore(db: Database): VmStore {
  const live = (userId: string) => and(eq(computerVm.ownerUserId, userId), ne(computerVm.status, "deleted"));
  return {
    list: (userId) => db.select().from(computerVm).where(live(userId)).orderBy(asc(computerVm.createdAt)),
    get: async (userId, id) => (await db.select().from(computerVm).where(and(live(userId), eq(computerVm.id, id))))[0],
    async ensureDefault(userId) {
      await db.insert(computerVm).values({ ownerUserId: userId, name: "Default", kind: "default" }).onConflictDoNothing();
      return (await db.select().from(computerVm).where(and(live(userId), eq(computerVm.kind, "default"))))[0]!;
    },
    create: async (userId, v) => (await db.insert(computerVm).values({ ownerUserId: userId, name: v.name, kind: "extra", purpose: v.purpose ?? null, createdByBotId: v.botId ?? null }).returning())[0]!,
    count: async (userId) => (await db.select({ id: computerVm.id }).from(computerVm).where(live(userId))).length,
    setStatus: async (id, status) => { await db.update(computerVm).set({ status, ...(status === "running" ? { lastStartedAt: new Date() } : {}), ...(status === "deleted" ? { deletedAt: new Date() } : {}) }).where(eq(computerVm.id, id)); },
    resetRunning: async () => { await db.update(computerVm).set({ status: "stopped" }).where(eq(computerVm.status, "running")); },
  };
}

export type VmOptions = { store: VmStore; docker: VmDocker; exec?: VmExec; connect?: VmConnect; tokenRoot: string; maxPerUser?: number; maxRunningPerUser?: number; maxRunning?: number; idleMs?: number; allowPrivate?: boolean };
export function createVmService({ store, docker, exec = createCliExec(docker.bin), connect = connectSpacesd, tokenRoot, maxPerUser = 4, maxRunningPerUser = 2, maxRunning = 6, idleMs = 15 * 60_000, allowPrivate = false }: VmOptions) {
  const sessions = new Map<string, VSession>();
  const serial = createSerializer();
  const reaper = setInterval(() => { for (const s of sessions.values()) if (Date.now() - s.lastUsed > idleMs) void stop(s.userId, s.id); }, 60_000); reaper.unref?.();
  const owned = async (userId: string, id: string) => { const row = await store.get(userId, id); if (!row) throw new ComputerError("NOT_FOUND"); return row; };
  /** A live session is only ever returned to its owner: another user's VM id is NOT_FOUND. */
  const live = (userId: string, id: string) => { const s = sessions.get(id); if (!s || s.userId !== userId) throw new ComputerError("NOT_FOUND"); s.lastUsed = Date.now(); return s; };
  const view = (row: VmRow) => { const s = sessions.get(row.id); return { id: row.id, name: row.name, kind: row.kind, purpose: row.purpose, createdByBotId: row.createdByBotId, status: s ? "running" as const : row.status === "running" ? "stopped" as const : row.status, control: s?.control ?? "agent", epoch: s?.epoch ?? 0 }; };
  const portOf = async (id: string) => { const r = await exec(["port", container(id), "3211/tcp"]); const m = /:(\d+)\s*$/m.exec(r.stdout.trim().split("\n")[0] ?? ""); if (r.code !== 0 || !m) throw new ComputerError("UNAVAILABLE"); return Number(m[1]); };

  /** Starts the user's VM (the default one when no id is given). One start at a time per user, so caps cannot be raced. */
  const start = (userId: string, vmId?: string) => serial(userId, async () => {
    const row = vmId ? await owned(userId, vmId) : await store.ensureDefault(userId);
    const existing = sessions.get(row.id);
    if (existing) { existing.lastUsed = Date.now(); return view(row); }
    const running = [...sessions.values()];
    if (running.filter((s) => s.userId === userId).length >= maxRunningPerUser || running.length >= maxRunning) throw new ComputerError("LIMIT");
    // A fresh bearer token per start. The file is rewritten in place, so an existing container's read-only bind mount sees it.
    const token = randomBytes(32).toString("base64url");
    const dir = join(tokenRoot, row.id); await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
    const tokenFile = join(dir, "token"); await writeFile(tokenFile, token, { mode: 0o644 });
    try {
      // A container built from an older image is recreated (all state lives on the home volume), so image updates reach existing VMs.
      const [had, want] = await Promise.all([exec(["inspect", "--format", "{{.Image}}", container(row.id)]), exec(["image", "inspect", "--format", "{{.Id}}", docker.image])]);
      if (had.code === 0 && want.code === 0 && had.stdout.trim() !== want.stdout.trim()) await exec(["rm", "-f", container(row.id)]);
      const started = had.code === 0 && had.stdout.trim() === want.stdout.trim() ? await exec(["start", container(row.id)]) : { code: 1 };
      if (started.code !== 0 && (await exec(vmDockerArgs(docker, { id: row.id, tokenFile }))).code !== 0) throw new ComputerError("UNAVAILABLE");
      const port = await portOf(row.id);
      const client = await connect(port, token);
      // "running" means usable: wait (bounded) for Chromium's window, so a bot's first keystroke has a target.
      for (let i = 0; i < 60; i++) { const w = await client.call("list_windows", {}).catch(() => undefined); if (w && !w.isError && /window_id=\d+/.test(w.text)) break; await Bun.sleep(500); }
      sessions.set(row.id, { id: row.id, userId, port, client, control: "agent", epoch: 0, lastUsed: Date.now(), queue: Promise.resolve() });
      await store.setStatus(row.id, "running");
      return view({ ...row, status: "running" });
    } catch (e) {
      await exec(["stop", "-t", "5", container(row.id)]).catch(() => undefined);
      await store.setStatus(row.id, "failed");
      throw e instanceof ComputerError ? e : new ComputerError("UNAVAILABLE");
    }
  });

  function act(userId: string, id: string, by: Actor, action: VmAction, opts: { signal?: AbortSignal; epoch?: number } = {}): Promise<{ id: string; control: "agent" | "human"; epoch: number }> {
    let s: VSession; try { s = live(userId, id); } catch (e) { return Promise.reject(e); }
    const run = s.queue.then(async () => {
      if (opts.signal?.aborted) throw new ComputerError("CANCELLED");
      if (by === "agent" && s.control === "human") throw new ComputerError("HUMAN_IN_CONTROL");
      if (by === "agent" && opts.epoch !== undefined && opts.epoch !== s.epoch) throw new ComputerError("STALE_CONTROL");
      const call = s.client.call;
      let r;
      if (action.type === "click") r = await call("click", { x: Math.round(action.x), y: Math.round(action.y), ...SCREEN });
      else if (action.type === "type") r = await call("type_text", { text: action.text.slice(0, 2000), ...FG });
      else if (action.type === "key") r = await pressKey(call, action.key.slice(0, 40));
      else if (action.type === "scroll") r = await call("scroll", { direction: action.direction, amount: Math.max(1, Math.min(20, action.amount ?? 3)), x: 640, y: 400, ...SCREEN });
      else if (action.type === "launch") { if (!SAFE_APP.test(action.app)) throw new ComputerError("INVALID"); r = await call("launch_app", { name: action.app }); }
      else {
        // Chromium is always open: focus its address bar, type, Enter. The address is checked first, like browser sessions.
        assertWebScheme(action.url); if (!allowPrivate) await assertPublicUrl(action.url);
        r = await call("hotkey", { keys: ["ctrl", "l"], ...FG });
        if (!r.isError) r = await call("type_text", { text: action.url, ...FG });
        if (!r.isError) r = await call("press_key", { key: "Return", ...FG });
      }
      if (r.isError) throw new ComputerError("UNAVAILABLE");
      s.lastUsed = Date.now();
      return { id: s.id, control: s.control, epoch: s.epoch };
    });
    s.queue = run.catch(() => undefined);
    return run;
  }

  async function stop(userId: string, id: string) {
    const s = sessions.get(id);
    if (!s || s.userId !== userId) { await owned(userId, id); return; }
    sessions.delete(id);
    await s.client.close().catch(() => undefined);
    await exec(["stop", "-t", "10", container(id)]).catch(() => undefined);
    await rm(join(tokenRoot, id), { recursive: true, force: true }).catch(() => undefined);
    await store.setStatus(id, "stopped");
  }

  return {
    start, act, stop,
    async list(userId: string) { return (await store.list(userId)).map(view); },
    /** Only an approved create_vm proposal calls this; the cap counts every VM the user has (the default included). */
    async create(userId: string, v: { name: string; purpose?: string | null; botId?: string | null }) {
      if (!SAFE_NAME.test(v.name)) throw new ComputerError("INVALID");
      return serial(userId, async () => { await store.ensureDefault(userId); if ((await store.count(userId)) >= maxPerUser) throw new ComputerError("LIMIT"); return view(await store.create(userId, v)); });
    },
    /** Deleting destroys the container AND its home volume (sign-ins, downloads). The default VM is recreated empty on next use. */
    async remove(userId: string, id: string) {
      await owned(userId, id);
      await stop(userId, id);
      await exec(["rm", "-f", container(id)]).catch(() => undefined);
      await exec(["volume", "rm", "-f", container(id)]).catch(() => undefined);
      await store.setStatus(id, "deleted");
    },
    async screenshot(userId: string, id: string) {
      const s = live(userId, id);
      const r = await s.client.call("get_desktop_state", {});
      if (r.isError || !r.imageBase64) throw new ComputerError("UNAVAILABLE");
      return r.imageBase64;
    },
    /** Text view for bots that cannot see images: windows plus the focused window's accessibility tree. */
    async read(userId: string, id: string) {
      const s = live(userId, id);
      const windows = await s.client.call("list_windows", {});
      const found = [...windows.text.matchAll(/window_id=(\d+) pid=(\d+) "([^"]*)"/g)];
      const top = found.find((m) => /chromium/i.test(m[3]!)) ?? found[0];
      if (windows.isError || !top) return windows.text.slice(0, 2000) || "No windows are open.";
      const r = await s.client.call("get_window_state", { pid: Number(top[2]), window_id: Number(top[1]), include_screenshot: false, max_elements: 300 });
      if (r.isError) throw new ComputerError("UNAVAILABLE");
      return r.text.slice(0, 8000);
    },
    takeover(userId: string, id: string, human: boolean, expected?: "agent" | "human") {
      const s = live(userId, id);
      if (expected && s.control !== expected) throw new ComputerError("STALE_CONTROL");
      if ((s.control === "human") !== human) { s.control = human ? "human" : "agent"; s.epoch++; }
      return { id: s.id, control: s.control, epoch: s.epoch };
    },
    epochOf: (userId: string, id: string) => live(userId, id).epoch,
    /** Boot: no session survives a restart, so stop every zetta VM container (volumes are kept) and mark rows stopped. */
    async sweep() {
      const r = await exec(["ps", "-a", "--filter", "label=zetta.vm=1", "--format", "{{.Names}}"]).catch(() => ({ code: 1, stdout: "" }));
      const names = r.code === 0 ? r.stdout.split("\n").map((x) => x.trim()).filter((x) => /^zetta-vm-[0-9a-f-]{36}$/.test(x)) : [];
      for (const n of names) await exec(["stop", "-t", "5", n]).catch(() => undefined);
      await store.resetRunning().catch(() => undefined);
      return names.length;
    },
    async closeAll() { clearInterval(reaper); await Promise.all([...sessions.values()].map((s) => stop(s.userId, s.id))); },
  };
}
export type VmService = ReturnType<typeof createVmService>;

/**
 * cua-driver input on Xvfb (checked against cua-spacesd 0.8.0): background delivery needs uinput, which a virtual X server cannot add,
 * so input is delivered in the foreground (the desktop is private to this VM); coordinates are screen pixels (scope "desktop").
 */
const FG = { delivery_mode: "foreground" } as const;
const SCREEN = { scope: "desktop", ...FG } as const;
/** "ctrl+l" style combos go through hotkey; a single key through press_key. */
const pressKey = (call: McpCall, key: string) => { const keys = key.split("+").map((k) => k.trim()).filter(Boolean); return keys.length > 1 ? call("hotkey", { keys, ...FG }) : call("press_key", { key, ...FG }); };

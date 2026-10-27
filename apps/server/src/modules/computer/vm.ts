import { createSerializer } from "./serial";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Database } from "@zetta/db";
import { and, asc, eq, ne } from "@zetta/db/query";
import { computerVm } from "@zetta/db/schema/features";
import { assertPublicUrl, assertWebScheme, ComputerError, type Actor } from "./service";
import type { McpCall } from "./desktop";
import type { CredentialField } from "../integrations/plugins/registry";
import { vncPassword } from "./vnc";
import { pickInput, type AxElement } from "../integrations/plugins/credentials";

/**
 * Persistent Linux desktops ("VMs") for computer use. Each row in computer_vm is one container from docker/desktop (Debian, TigerVNC,
 * XFCE, Chromium) running cua-spacesd; the server drives it over spacesd's Streamable-HTTP MCP on a loopback-published port with a
 * bearer token minted for that start. Home is the named volume `zetta-vm-<id>`, so sign-ins survive idle stops; delete destroys it.
 * Every user has one default VM (created on first use); extra VMs exist only after the user approves a bot's create_vm proposal.
 * People see and control the VM through VNC (TigerVNC on 5900, also loopback-published, with a per-start password): the browser gets a
 * one-time ticket and the server bridges its WebSocket to x11vnc (see vnc.ts), so neither the port nor the password reach the client.
 * Control/takeover is the same as for browser sessions: agent actions are refused while a person holds control, and an epoch
 * invalidates stale agent turns.
 * Consistency: a running container is never restarted just because this process has no session for it (a `bun --hot` reload, a second
 * server, a restart). The process reattaches with the token on disk; only when that fails is the container restarted with a new one.
 * Activity is recorded in a file next to the token, so an idle stop in one process never kills a VM another process is driving, and a
 * session whose transport died is dropped (DISCONNECTED) so the next start reattaches instead of failing every call.
 */
export type VmAction =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { type: "launch"; app: string }
  | { type: "navigate"; url: string };
export type VmRow = typeof computerVm.$inferSelect;
export type VmStore = {
  list(userId: string): Promise<VmRow[]>;
  get(userId: string, id: string): Promise<VmRow | undefined>;
  ensureDefault(userId: string): Promise<VmRow>;
  create(
    userId: string,
    v: { name: string; purpose?: string | null; botId?: string | null },
  ): Promise<VmRow>;
  count(userId: string): Promise<number>;
  setStatus(id: string, status: VmRow["status"]): Promise<void>;
  resetRunning(): Promise<void>;
};
export type VmDocker = {
  bin: string;
  image: string;
  memory: string;
  cpus: string;
  pids: number;
  shm: string;
  runtime?: string;
  network?: string;
};
/** Runs the container CLI; injectable so tests do not need Docker. */
export type VmExec = (args: string[]) => Promise<{ code: number; stdout: string }>;
/** `attempts` bounds the health wait (250 ms apart): a reattach to a container that should already be up gives up quickly. */
export type VmConnect = (
  port: number,
  token: string,
  attempts?: number,
) => Promise<{ call: McpCall; close: () => Promise<void> }>;

type VSession = {
  id: string;
  userId: string;
  port: number;
  vnc: { port: number; password: string };
  viewers: number;
  client: Awaited<ReturnType<VmConnect>>;
  control: "agent" | "human";
  epoch: number;
  lastUsed: number;
  queue: Promise<unknown>;
  keyboard: KeyboardLayout;
};
/** Keyboard layouts a person can pick for their VM (setxkbmap layout[:variant]). */
export const KEYBOARD_LAYOUTS = [
  "us",
  "us:intl",
  "br",
  "gb",
  "pt",
  "es",
  "latam",
  "de",
  "fr",
  "it",
] as const;
export type KeyboardLayout = (typeof KEYBOARD_LAYOUTS)[number];
const SAFE_APP = /^[A-Za-z0-9._ -]{1,60}$/;
const SAFE_NAME = /^[\p{L}\p{N} ._-]{1,60}$/u;
const container = (id: string) => `zetta-vm-${id}`;
/** An error from outside spacesd (e.g. a credential grant refusing) that `guard` must rethrow as is. */
class Passthrough {
  constructor(readonly error: unknown) {}
}

/** `ZETTA_DESKTOP_RUNTIME=docker` turns on per-user VMs; the rest tunes the container. */
export function dockerVmConfig(env: NodeJS.ProcessEnv = process.env): VmDocker | undefined {
  if (env.ZETTA_DESKTOP_RUNTIME !== "docker") return undefined;
  return {
    bin: env.ZETTA_DOCKER_BIN ?? "docker",
    image: env.ZETTA_VM_IMAGE ?? "zetta-desktop:latest",
    memory: env.ZETTA_VM_MEMORY ?? "2g",
    cpus: env.ZETTA_VM_CPUS ?? "2",
    pids: Number(env.ZETTA_VM_PIDS ?? 1024),
    shm: env.ZETTA_VM_SHM ?? "1g",
    runtime: env.ZETTA_VM_RUNTIME || undefined,
    network: env.ZETTA_VM_NETWORK || undefined,
  };
}
export function vmDockerArgs(d: VmDocker, o: { id: string; tokenFile: string; vncFile: string }) {
  return [
    "run",
    "-d",
    "--name",
    container(o.id),
    "--label",
    "zetta.vm=1",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit",
    String(d.pids),
    "--memory",
    d.memory,
    "--cpus",
    d.cpus,
    "--shm-size",
    d.shm,
    ...(d.runtime ? ["--runtime", d.runtime] : []),
    ...(d.network ? ["--network", d.network] : []),
    "-v",
    `${container(o.id)}:/home/agent`,
    "-v",
    `${o.tokenFile}:/run/zetta/token:ro`,
    "-v",
    `${o.vncFile}:/run/zetta/vncpass:ro`,
    "-p",
    "127.0.0.1::3211",
    "-p",
    "127.0.0.1::5900",
    d.image,
  ];
}

export function createCliExec(bin: string): VmExec {
  return async (args) => {
    const p = Bun.spawn([bin, ...args], {
      stdout: "pipe",
      stderr: "ignore",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    const stdout = await new Response(p.stdout).text();
    return { code: await p.exited, stdout };
  };
}

/** Production transport: spacesd's MCP endpoint, bearer token in a header (never in a URL), after its health check answers. */
export const connectSpacesd: VmConnect = async (port, token, attempts = 240) => {
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${token}` };
  let ok = false;
  for (let i = 0; i < attempts && !ok; i++) {
    ok = await fetch(`${base}/health`, { headers }).then(
      (r) => r.ok,
      () => false,
    );
    if (!ok) await Bun.sleep(250);
  }
  if (!ok) throw new ComputerError("UNAVAILABLE");
  const c = new Client({ name: "zetta-vm", version: "1" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  return {
    call: async (tool, args) => {
      const r = (await c.callTool({ name: tool, arguments: args }, undefined, {
        timeout: 60_000,
      })) as {
        isError?: boolean;
        content?: { type: string; text?: string; data?: string }[];
        structuredContent?: unknown;
      };
      return {
        text: (r.content ?? [])
          .filter((x) => x.type === "text")
          .map((x) => x.text ?? "")
          .join("\n"),
        imageBase64: r.content?.find((x) => x.type === "image")?.data,
        isError: Boolean(r.isError),
        structured: r.structuredContent,
      };
    },
    close: () => c.close().catch(() => {}),
  };
};

export function createDbVmStore(db: Database): VmStore {
  const live = (userId: string) =>
    and(eq(computerVm.ownerUserId, userId), ne(computerVm.status, "deleted"));
  return {
    list: (userId) =>
      db.select().from(computerVm).where(live(userId)).orderBy(asc(computerVm.createdAt)),
    get: async (userId, id) =>
      (
        await db
          .select()
          .from(computerVm)
          .where(and(live(userId), eq(computerVm.id, id)))
      )[0],
    async ensureDefault(userId) {
      await db
        .insert(computerVm)
        .values({ ownerUserId: userId, name: "Default", kind: "default" })
        .onConflictDoNothing();
      return (
        await db
          .select()
          .from(computerVm)
          .where(and(live(userId), eq(computerVm.kind, "default")))
      )[0]!;
    },
    create: async (userId, v) =>
      (
        await db
          .insert(computerVm)
          .values({
            ownerUserId: userId,
            name: v.name,
            kind: "extra",
            purpose: v.purpose ?? null,
            createdByBotId: v.botId ?? null,
          })
          .returning()
      )[0]!,
    count: async (userId) =>
      (await db.select({ id: computerVm.id }).from(computerVm).where(live(userId))).length,
    setStatus: async (id, status) => {
      await db
        .update(computerVm)
        .set({
          status,
          ...(status === "running" ? { lastStartedAt: new Date() } : {}),
          ...(status === "deleted" ? { deletedAt: new Date() } : {}),
        })
        .where(eq(computerVm.id, id));
    },
    resetRunning: async () => {
      await db
        .update(computerVm)
        .set({ status: "stopped" })
        .where(eq(computerVm.status, "running"));
    },
  };
}

export type VmOptions = {
  store: VmStore;
  docker: VmDocker;
  exec?: VmExec;
  connect?: VmConnect;
  tokenRoot: string;
  maxPerUser?: number;
  maxRunningPerUser?: number;
  maxRunning?: number;
  idleMs?: number;
  allowPrivate?: boolean;
};
export function createVmService({
  store,
  docker,
  exec = createCliExec(docker.bin),
  connect = connectSpacesd,
  tokenRoot,
  maxPerUser = 4,
  maxRunningPerUser = 2,
  maxRunning = 6,
  idleMs = 15 * 60_000,
  allowPrivate = false,
}: VmOptions) {
  const sessions = new Map<string, VSession>();
  const tickets = new Map<string, { userId: string; id: string; expires: number }>();
  const serial = createSerializer();
  /** Containers found running at boot that were still in use: stopped by the reaper once nobody (in any process) touched them for idleMs. */
  const orphans = new Set<string>();
  const activityFile = (id: string) => join(tokenRoot, id, "active");
  const lastActive = async (id: string) =>
    (await stat(activityFile(id)).catch(() => undefined))?.mtimeMs ?? 0;
  const touched = new Map<string, number>();
  /** Shared across processes (and hot reloads): at most one write per 10 s per VM. */
  const touch = (id: string) => {
    const now = Date.now();
    if (now - (touched.get(id) ?? 0) < 10_000) return Promise.resolve();
    touched.set(id, now);
    const t = new Date(now);
    return utimes(activityFile(id), t, t).catch(() =>
      writeFile(activityFile(id), "").catch(() => undefined),
    );
  };
  async function reap() {
    for (const s of sessions.values()) {
      if (s.viewers > 0) {
        await touch(s.id);
        continue;
      }
      if (Date.now() - Math.max(s.lastUsed, await lastActive(s.id)) > idleMs)
        await stop(s.userId, s.id).catch(() => undefined);
    }
    for (const id of orphans) {
      if (sessions.has(id)) {
        orphans.delete(id);
        continue;
      }
      if (Date.now() - (await lastActive(id)) <= idleMs) continue;
      orphans.delete(id);
      await exec(["stop", "-t", "10", container(id)]).catch(() => undefined);
      await store.setStatus(id, "stopped").catch(() => undefined);
    }
  }
  const reaper = setInterval(() => void reap(), 60_000);
  reaper.unref?.();
  /** The transport to spacesd failed (the container stopped or restarted with another token): forget the session so the next start reattaches. */
  const drop = (s: VSession) => {
    if (sessions.get(s.id) === s) sessions.delete(s.id);
    void s.client.close().catch(() => undefined);
  };
  /** Runs spacesd calls for a session; a transport failure (not a tool error) drops it and surfaces as DISCONNECTED. */
  const guard = async <T>(s: VSession, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (e) {
      if (e instanceof Passthrough) throw e.error;
      if (e instanceof ComputerError) throw e;
      drop(s);
      throw new ComputerError("DISCONNECTED");
    }
  };
  const owned = async (userId: string, id: string) => {
    const row = await store.get(userId, id);
    if (!row) throw new ComputerError("NOT_FOUND");
    return row;
  };
  /** A live session is only ever returned to its owner: another user's VM id is NOT_FOUND. */
  const live = (userId: string, id: string) => {
    const s = sessions.get(id);
    if (!s || s.userId !== userId) throw new ComputerError("NOT_FOUND");
    s.lastUsed = Date.now();
    void touch(id);
    return s;
  };
  const view = (row: VmRow) => {
    const s = sessions.get(row.id);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      purpose: row.purpose,
      createdByBotId: row.createdByBotId,
      status: s
        ? ("running" as const)
        : row.status === "running"
          ? ("stopped" as const)
          : row.status,
      control: s?.control ?? "agent",
      epoch: s?.epoch ?? 0,
      keyboard: s?.keyboard ?? "us",
    };
  };
  const portOf = async (id: string, inner: number) => {
    const r = await exec(["port", container(id), `${inner}/tcp`]);
    const m = /:(\d+)\s*$/m.exec(r.stdout.trim().split("\n")[0] ?? "");
    if (r.code !== 0 || !m) throw new ComputerError("UNAVAILABLE");
    return Number(m[1]);
  };

  /** Starts the user's VM (the default one when no id is given). One start at a time per user, so caps cannot be raced. */
  const start = (userId: string, vmId?: string) =>
    serial(userId, async () => {
      const row = vmId ? await owned(userId, vmId) : await store.ensureDefault(userId);
      const existing = sessions.get(row.id);
      if (existing) {
        existing.lastUsed = Date.now();
        return view(row);
      }
      const running = [...sessions.values()];
      if (
        running.filter((s) => s.userId === userId).length >= maxRunningPerUser ||
        running.length >= maxRunning
      )
        throw new ComputerError("LIMIT");
      const dir = join(tokenRoot, row.id),
        tokenFile = join(dir, "token"),
        vncFile = join(dir, "vncpass");
      try {
        // A container built from an older image is recreated (all state lives on the home volume), so image updates reach existing VMs.
        const [had, want] = await Promise.all([
          exec(["inspect", "--format", "{{.Image}} {{.State.Running}}", container(row.id)]),
          exec(["image", "inspect", "--format", "{{.Id}}", docker.image]),
        ]);
        const [image, running] = had.stdout.trim().split(/\s+/);
        const current = had.code === 0 && want.code === 0 && image === want.stdout.trim();
        // Still running with no session here (a hot reload, another server process, a restart): reattach with the token it already has.
        // Restarting it instead would kill whatever another process (or the previous module instance) is doing on it right now.
        if (current && running === "true") {
          const back = await reattach(row.id, userId, tokenFile, vncFile);
          if (back) {
            orphans.delete(row.id);
            await store.setStatus(row.id, "running");
            return view({ ...row, status: "running" });
          }
        }
        if (had.code === 0 && want.code === 0 && !current)
          await exec(["rm", "-f", container(row.id)]);
        // A fresh bearer token per (re)start. The file is rewritten in place, so an existing container's read-only bind mount sees it.
        const token = randomBytes(32).toString("base64url");
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
        await writeFile(tokenFile, token, { mode: 0o644 });
        const password = vncPassword();
        await writeFile(vncFile, `${password}\n`, { mode: 0o644 });
        // Running but not reattachable (token lost or rejected): restart it so it reads this start's token and VNC password.
        const started = current
          ? await exec([
              running === "true" ? "restart" : "start",
              ...(running === "true" ? ["-t", "5"] : []),
              container(row.id),
            ])
          : { code: 1 };
        if (
          started.code !== 0 &&
          (await exec(vmDockerArgs(docker, { id: row.id, tokenFile, vncFile }))).code !== 0
        )
          throw new ComputerError("UNAVAILABLE");
        const [port, vncPort] = await Promise.all([portOf(row.id, 3211), portOf(row.id, 5900)]);
        const client = await connect(port, token);
        // "running" means usable: wait (bounded) for Chromium's window, so a bot's first keystroke has a target.
        for (let i = 0; i < 60; i++) {
          const w = await client.call("list_windows", {}).catch(() => undefined);
          if (w && !w.isError && /window_id=\d+ pid=\d+ "[^"]*Chromium/i.test(w.text)) break;
          await Bun.sleep(500);
        }
        // Right after boot no window is active, and foreground input is refused until one is (see `focused`).
        const win = await chromium(client.call).catch(() => undefined);
        if (win) await client.call("bring_to_front", win).catch(() => undefined);
        sessions.set(row.id, {
          id: row.id,
          userId,
          port,
          vnc: { port: vncPort, password },
          viewers: 0,
          keyboard: "us",
          client,
          control: "agent",
          epoch: 0,
          lastUsed: Date.now(),
          queue: Promise.resolve(),
        });
        orphans.delete(row.id);
        touched.delete(row.id);
        await touch(row.id);
        await store.setStatus(row.id, "running");
        return view({ ...row, status: "running" });
      } catch (e) {
        await exec(["stop", "-t", "5", container(row.id)]).catch(() => undefined);
        await store.setStatus(row.id, "failed");
        throw e instanceof ComputerError ? e : new ComputerError("UNAVAILABLE");
      }
    });

  /** A session for a container that is already running, from the token and VNC password on disk; undefined when they no longer work. */
  async function reattach(id: string, userId: string, tokenFile: string, vncFile: string) {
    const [token, password] = await Promise.all([
      readFile(tokenFile, "utf8").catch(() => ""),
      readFile(vncFile, "utf8").then(
        (x) => x.trim(),
        () => "",
      ),
    ]);
    if (!token || !password) return undefined;
    const ports = await Promise.all([portOf(id, 3211), portOf(id, 5900)]).catch(() => undefined);
    if (!ports) return undefined;
    const client = await connect(ports[0], token, 8).catch(() => undefined);
    if (!client) return undefined;
    const probe = await client.call("list_windows", {}).catch(() => undefined);
    if (!probe || probe.isError) {
      await client.close().catch(() => undefined);
      return undefined;
    }
    const s: VSession = {
      id,
      userId,
      port: ports[0],
      vnc: { port: ports[1], password },
      viewers: 0,
      keyboard: "us",
      client,
      control: "agent",
      epoch: 0,
      lastUsed: Date.now(),
      queue: Promise.resolve(),
    };
    sessions.set(id, s);
    touched.delete(id);
    await touch(id);
    return s;
  }

  function act(
    userId: string,
    id: string,
    by: Actor,
    action: VmAction,
    opts: { signal?: AbortSignal; epoch?: number } = {},
  ): Promise<{ id: string; control: "agent" | "human"; epoch: number }> {
    let s: VSession;
    try {
      s = live(userId, id);
    } catch (e) {
      return Promise.reject(e);
    }
    const run = s.queue.then(async () => {
      if (opts.signal?.aborted) throw new ComputerError("CANCELLED");
      if (by === "agent" && s.control === "human") throw new ComputerError("HUMAN_IN_CONTROL");
      if (by === "agent" && opts.epoch !== undefined && opts.epoch !== s.epoch)
        throw new ComputerError("STALE_CONTROL");
      if (sessions.get(s.id) !== s) throw new ComputerError("DISCONNECTED");
      return guard(s, async () => {
        const call = focused(s.client.call);
        let r;
        if (action.type === "click")
          r = await call("click", { x: Math.round(action.x), y: Math.round(action.y), ...SCREEN });
        else if (action.type === "type")
          r = await call("type_text", { text: action.text.slice(0, 2000), ...FG });
        else if (action.type === "key") r = await pressKey(call, action.key.slice(0, 40));
        else if (action.type === "scroll")
          r = await call("scroll", {
            direction: action.direction,
            amount: Math.max(1, Math.min(20, action.amount ?? 3)),
            x: 640,
            y: 400,
            ...SCREEN,
          });
        else if (action.type === "launch") {
          if (!SAFE_APP.test(action.app)) throw new ComputerError("INVALID");
          r = await call("launch_app", { name: action.app });
        } else {
          // Chromium is always open: focus its address bar, type, Enter. The address is checked first, like browser sessions.
          assertWebScheme(action.url);
          if (!allowPrivate) await assertPublicUrl(action.url);
          r = await call("hotkey", { keys: ["ctrl", "l"], ...FG });
          if (!r.isError) r = await call("type_text", { text: action.url, ...FG });
          if (!r.isError) r = await call("press_key", { key: "Return", ...FG });
        }
        if (r.isError) throw new ComputerError("UNAVAILABLE");
        s.lastUsed = Date.now();
        return { id: s.id, control: s.control, epoch: s.epoch };
      });
    });
    s.queue = run.catch(() => undefined);
    return run;
  }

  /** Chromium's window in this VM (the one bots drive), as list_windows reports it. */
  async function chromium(call: McpCall) {
    const windows = await call("list_windows", {});
    const found = [...windows.text.matchAll(/window_id=(\d+) pid=(\d+) "([^"]*)"/g)];
    const top = found.find((m) => /chromium/i.test(m[3]!));
    return windows.isError || !top ? undefined : { window_id: Number(top[1]), pid: Number(top[2]) };
  }
  /**
   * Foreground input needs an active window. Openbox has none right after boot, or after the focused window closed, and cua-driver then
   * refuses with `foreground_unavailable` without sending anything: activate Chromium and retry that one call once.
   */
  const focused =
    (call: McpCall): McpCall =>
    async (tool, args) => {
      const r = await call(tool, args);
      if (!r.isError || !/foreground_unavailable/.test(r.text)) return r;
      const win = await chromium(call).catch(() => undefined);
      if (!win) return r;
      await call("bring_to_front", win).catch(() => undefined);
      return call(tool, args);
    };
  /**
   * Types one credential into the sign-in input of the VM's Chromium as ONE queued step, so no other action can slip in between the checks
   * and the typing. Checked against cua-spacesd 0.8.0: its accessibility tree carries roles, labels and frames but neither field values
   * nor focus, so the server picks the input itself (by role/label, see pickInput) and reads the real address from the omnibox through
   * the VM's own clipboard (restored afterwards). `reveal(url)` checks the grant and the origin and returns the value; it is typed and
   * never read back.
   */
  function fillCredential(
    userId: string,
    id: string,
    field: CredentialField,
    reveal: (url: string) => Promise<string>,
    opts: { signal?: AbortSignal; epoch?: number } = {},
  ): Promise<{ label: string }> {
    let s: VSession;
    try {
      s = live(userId, id);
    } catch (e) {
      return Promise.reject(e);
    }
    const run = s.queue.then(async () => {
      if (opts.signal?.aborted) throw new ComputerError("CANCELLED");
      if (s.control === "human") throw new ComputerError("HUMAN_IN_CONTROL");
      if (opts.epoch !== undefined && opts.epoch !== s.epoch)
        throw new ComputerError("STALE_CONTROL");
      if (sessions.get(s.id) !== s) throw new ComputerError("DISCONNECTED");
      return guard(s, async () => {
        const call = focused(s.client.call),
          win = await chromium(call);
        if (!win) throw new ComputerError("NO_ADDRESS");
        const state = await call("get_window_state", {
          ...win,
          include_screenshot: false,
          max_elements: 400,
          tree_format: "elements",
        });
        const st = (state.structured ?? {}) as {
          elements?: AxElement[];
          window_bounds?: { x?: number; y?: number };
        };
        if (state.isError || !Array.isArray(st.elements)) throw new ComputerError("UNAVAILABLE");
        if (st.elements.some((e) => e.role === "button" && /^not secure$/i.test(e.label ?? "")))
          throw new ComputerError("INSECURE");
        const input = pickInput(field, st.elements);
        if (!input?.frame) throw new ComputerError("NO_INPUT");
        const text = (r: Awaited<ReturnType<McpCall>>) => {
          const t = (r.structured as { text?: unknown } | undefined)?.text;
          return typeof t === "string" ? t : undefined;
        };
        const before = text(await call("clipboard_read", { include_text: true }));
        let url: string | undefined;
        try {
          if (
            !(await call("hotkey", { keys: ["ctrl", "l"], ...FG })).isError &&
            !(await call("hotkey", { keys: ["ctrl", "c"], ...FG })).isError
          )
            url = text(await call("clipboard_read", { include_text: true }))?.trim();
        } finally {
          await call("press_key", { key: "Escape", ...FG }).catch(() => undefined);
          await call("clipboard_write", { text: before ?? "" }).catch(() => undefined);
        }
        if (!url || !/^https?:\/\/\S+$/i.test(url)) throw new ComputerError("NO_ADDRESS");
        const value = await reveal(url).catch((e: unknown) => {
          throw new Passthrough(e);
        }); // the grant's own refusal, not a transport failure
        const ox = st.window_bounds?.x ?? 0,
          oy = st.window_bounds?.y ?? 0,
          f = input.frame;
        let r = await call("click", {
          x: Math.round(ox + f.x + f.w / 2),
          y: Math.round(oy + f.y + f.h / 2),
          ...SCREEN,
        });
        if (!r.isError) r = await call("type_text", { text: value.slice(0, 2000), ...FG });
        if (r.isError) throw new ComputerError("UNAVAILABLE");
        s.lastUsed = Date.now();
        return { label: input.label ?? field };
      });
    });
    s.queue = run.catch(() => undefined);
    return run;
  }

  async function stop(userId: string, id: string) {
    const s = sessions.get(id);
    if (!s || s.userId !== userId) {
      await owned(userId, id);
      return;
    }
    sessions.delete(id);
    await s.client.close().catch(() => undefined);
    await exec(["stop", "-t", "10", container(id)]).catch(() => undefined);
    await rm(join(tokenRoot, id), { recursive: true, force: true }).catch(() => undefined);
    await store.setStatus(id, "stopped");
  }

  return {
    start,
    act,
    stop,
    fillCredential,
    async list(userId: string) {
      return (await store.list(userId)).map(view);
    },
    /** Only an approved create_vm proposal calls this; the cap counts every VM the user has (the default included). */
    async create(
      userId: string,
      v: { name: string; purpose?: string | null; botId?: string | null },
    ) {
      if (!SAFE_NAME.test(v.name)) throw new ComputerError("INVALID");
      return serial(userId, async () => {
        await store.ensureDefault(userId);
        if ((await store.count(userId)) >= maxPerUser) throw new ComputerError("LIMIT");
        return view(await store.create(userId, v));
      });
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
      const r = await guard(s, () => s.client.call("get_desktop_state", {}));
      if (r.isError || !r.imageBase64) throw new ComputerError("UNAVAILABLE");
      return r.imageBase64;
    },
    /** Text view for bots that cannot see images: windows plus the focused window's accessibility tree. */
    async read(userId: string, id: string) {
      const s = live(userId, id);
      return guard(s, async () => {
        const windows = await s.client.call("list_windows", {});
        const found = [...windows.text.matchAll(/window_id=(\d+) pid=(\d+) "([^"]*)"/g)];
        const top = found.find((m) => /chromium/i.test(m[3]!)) ?? found[0];
        if (windows.isError || !top) return windows.text.slice(0, 2000) || "No windows are open.";
        const r = await s.client.call("get_window_state", {
          pid: Number(top[2]),
          window_id: Number(top[1]),
          include_screenshot: false,
          max_elements: 1500,
        });
        if (r.isError) throw new ComputerError("UNAVAILABLE");
        return `Window "${top[3]}":\n${compactTree(r.text)}`.slice(0, 12_000);
      });
    },
    takeover(userId: string, id: string, human: boolean, expected?: "agent" | "human") {
      const s = live(userId, id);
      if (expected && s.control !== expected) throw new ComputerError("STALE_CONTROL");
      if ((s.control === "human") !== human) {
        s.control = human ? "human" : "agent";
        s.epoch++;
      }
      return { id: s.id, control: s.control, epoch: s.epoch };
    },
    epochOf: (userId: string, id: string) => live(userId, id).epoch,
    /** A person's "paste": the text is typed into the focused window as keystrokes, so terminals and pages both take it. */
    async paste(userId: string, id: string, text: string) {
      live(userId, id);
      const r = await exec([
        "exec",
        container(id),
        "xdotool",
        "type",
        "--clearmodifiers",
        "--delay",
        "6",
        "--",
        text.slice(0, 4000),
      ]);
      if (r.code !== 0) throw new ComputerError("UNAVAILABLE");
    },
    /** The VM's X keyboard layout, so keys typed through VNC produce the characters printed on the person's keyboard. */
    async keyboard(userId: string, id: string, layout: string) {
      const s = live(userId, id);
      if (!(KEYBOARD_LAYOUTS as readonly string[]).includes(layout))
        throw new ComputerError("INVALID");
      const [name, variant] = layout.split(":");
      const r = await exec([
        "exec",
        container(id),
        "setxkbmap",
        "-layout",
        name!,
        ...(variant ? ["-variant", variant] : []),
      ]);
      if (r.code !== 0) throw new ComputerError("UNAVAILABLE");
      s.keyboard = layout as KeyboardLayout;
      return s.keyboard;
    },
    /** A one-time, 30-second ticket for opening the VNC WebSocket (browsers cannot set headers on one). Only for a running VM. */
    vncTicket(userId: string, id: string) {
      live(userId, id);
      for (const [k, t] of tickets) if (t.expires < Date.now()) tickets.delete(k);
      const ticket = randomBytes(24).toString("base64url");
      tickets.set(ticket, { userId, id, expires: Date.now() + 30_000 });
      return ticket;
    },
    /** Redeems a ticket for that VM: where its VNC server listens, plus release() for when the viewer leaves. Idle stop waits for viewers. */
    vncViewer(ticket: string, id: string) {
      const t = tickets.get(ticket);
      tickets.delete(ticket);
      if (!t || t.id !== id || t.expires < Date.now()) throw new ComputerError("NOT_FOUND");
      const s = live(t.userId, id);
      s.viewers++;
      let released = false;
      return {
        userId: t.userId,
        port: s.vnc.port,
        password: s.vnc.password,
        release: () => {
          if (!released) {
            released = true;
            s.viewers--;
            s.lastUsed = Date.now();
          }
        },
      };
    },
    /**
     * Boot: stop the zetta VM containers nobody used for idleMs (volumes are kept) and mark rows stopped. A VM another process (or the
     * previous one, seconds ago) is still driving keeps running: the next start reattaches to it, and the reaper stops it once idle.
     */
    async sweep() {
      const r = await exec([
        "ps",
        "-a",
        "--filter",
        "label=zetta.vm=1",
        "--format",
        "{{.Names}}",
      ]).catch(() => ({ code: 1, stdout: "" }));
      const names =
        r.code === 0
          ? r.stdout
              .split("\n")
              .map((x) => x.trim())
              .filter((x) => /^zetta-vm-[0-9a-f-]{36}$/.test(x))
          : [];
      let stopped = 0;
      for (const n of names) {
        const id = n.slice("zetta-vm-".length);
        if (Date.now() - (await lastActive(id)) <= idleMs) {
          orphans.add(id);
          continue;
        }
        await exec(["stop", "-t", "5", n]).catch(() => undefined);
        stopped++;
      }
      await store.resetRunning().catch(() => undefined);
      return stopped;
    },
    async closeAll() {
      clearInterval(reaper);
      await Promise.all([...sessions.values()].map((s) => stop(s.userId, s.id)));
    },
    /** A `bun --hot` reload replaced this service: stop its timer and connections but leave the containers to the new instance. */
    detach() {
      clearInterval(reaper);
      for (const s of sessions.values()) void s.client.close().catch(() => undefined);
      sessions.clear();
    },
  };
}
export type VmService = ReturnType<typeof createVmService>;

/**
 * cua-driver input on Xvfb (checked against cua-spacesd 0.8.0): background delivery needs uinput, which a virtual X server cannot add,
 * so input is delivered in the foreground (the desktop is private to this VM); coordinates are screen pixels (scope "desktop").
 */
const FG = { delivery_mode: "foreground" } as const;
const SCREEN = { scope: "desktop", ...FG } as const;
/**
 * The accessibility tree as readable text: page content sits hundreds of rows deep under unlabelled panels and sections, so the raw tree
 * runs out of budget in the site's header. Keeps one line per element that has text (role and label), drops actions, indices, the
 * placeholder characters of empty containers and a label repeated by its own child.
 */
export function compactTree(tree: string) {
  const out: string[] = [];
  let last = "";
  for (const raw of tree.split("\n")) {
    const m =
      /^\s*- (?:\[\d+\] )?([a-z][a-z ]*?)(?: = | )"(.*?)"(?: \(description "(.*?)"\))?(?: .*)?$/.exec(
        raw.replace(/\uFFFC/g, ""),
      );
    if (!m) continue;
    const [, role, label = "", description = ""] = m;
    const text = (label.trim() || description.trim()).replace(/\s+/g, " ");
    if (!text || text === last) continue;
    last = text;
    out.push(
      role === "static" || role === "section" || role === "panel" ? text : `${role} "${text}"`,
    );
  }
  return out.join("\n");
}

/** "ctrl+l" style combos go through hotkey; a single key through press_key. */
const pressKey = (call: McpCall, key: string) => {
  const keys = key
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.length > 1 ? call("hotkey", { keys, ...FG }) : call("press_key", { key, ...FG });
};

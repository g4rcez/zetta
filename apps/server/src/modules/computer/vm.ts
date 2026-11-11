import { desktopTargets, type InstallMode } from "./placement";
import { createSerializer } from "./serial";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@zetta/db";
import { and, asc, eq, ne } from "@zetta/db/query";
import { computerVm } from "@zetta/db/schema/features";
import { assertPublicUrl, assertWebScheme, ComputerError, type Actor } from "./service";
import {
  NavigationError,
  navigatePage,
  pageLinks,
  settlePage,
  type NavigateResult,
  type PageLinks,
} from "./cdp";
import type { CredentialField } from "../integrations/plugins/registry";
import { vncPassword } from "./vnc";
import {
  connectSpacesd,
  connectSpacesdUrl,
  type RemoteConnect,
  type VmConnect,
} from "./mcp-client";
import { createCuaDriver } from "./drivers/cua";
import { createAgentDesktopDriver } from "./drivers/agent-desktop";
import { hasBrowser, osOptions, type OsId } from "./os";
import { instanceId, recoverable } from "../runtime/instance";
import { envNumber } from "../env-number";
import {
  DRIVERS,
  Passthrough,
  type DesktopDriver,
  type DriverName,
  type VmAction,
} from "./drivers/types";

export { connectSpacesd, type McpCall, type VmConnect } from "./mcp-client";
export { compactTree } from "./drivers/cua";
export type { VmAction } from "./drivers/types";

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
// `owner_instance` is the server's own bookkeeping (see runtime/instance.ts), not part of a VM's record.
export type VmRow = Omit<typeof computerVm.$inferSelect, "ownerInstance">;
export type VmTarget = VmRow["target"];
export { vmOsFrom, type OsId } from "./os";
export type VmStore = {
  list(userId: string): Promise<VmRow[]>;
  get(userId: string, id: string): Promise<VmRow | undefined>;
  ensureDefault(userId: string): Promise<VmRow>;
  create(
    userId: string,
    v: {
      name: string;
      purpose?: string | null;
      botId?: string | null;
      target?: VmTarget;
      driver?: DriverName;
      os?: OsId;
      /** Target "cua": where its spacesd listens, and the sealed bearer token (a `connection`). */
      endpoint?: string | null;
      connectionId?: string | null;
    },
  ): Promise<VmRow>;
  setDriver(userId: string, id: string, driver: DriverName): Promise<void>;
  count(userId: string): Promise<number>;
  setStatus(id: string, status: VmRow["status"]): Promise<void>;
  resetRunning(): Promise<void>;
};
export type VmDocker = {
  bin: string;
  image: string;
  /** Images for the other systems (Debian is `image`); default zetta-desktop-ubuntu:latest. */
  images?: Partial<Record<OsId, string>>;
  memory: string;
  cpus: string;
  pids: number;
  shm: string;
  runtime?: string;
  network?: string;
};
/** Runs the container CLI; injectable so tests do not need Docker. */
export type VmExec = (
  args: string[],
  opts?: { signal?: AbortSignal | undefined; timeout?: number },
) => Promise<{ code: number; stdout: string }>;
type VSession = {
  id: string;
  userId: string;
  port: number;
  /** Absent for a remote computer: there is no VNC server to bridge to. */
  vnc?: { port: number; password: string };
  /** A computer on another machine (target "cua"): nothing of it runs in a container here. */
  remote?: boolean;
  viewers: number;
  /** The computer's image has a browser: no browser means no navigate and no sign-in fill. */
  browser: boolean;
  /** Ends the connection to the driver: a Cua MCP session; nothing for agent-desktop, which runs one command per call. */
  close: () => Promise<void>;
  driver: DesktopDriver;
  control: "agent" | "human";
  epoch: number;
  lastUsed: number;
  queue: Promise<unknown>;
  keyboard: KeyboardLayout;
  /** The published DevTools port, looked up at the first read; null when the VM's image has none (started before it was added). */
  cdp?: number | null;
  row?: VmRow;
};
/** Added to a read of a page that was still changing, so an empty-looking read says what to do instead of leaving the bot to guess a cause. */
export const STILL_LOADING = "(The page was still loading when read: read again for the rest.)";
const BLANK_TAB = "The browser shows an empty tab (about:blank): navigate again.";
/**
 * A read as the bot gets it: the window title, the page address, the numbered screen and, for an explicit read, where each link goes
 * (the accessibility tree has no addresses, so without it a bot cannot cite a permalink). A settle read stays small: no link list.
 */
export function formatRead(
  title: string | undefined,
  body: string,
  page: PageLinks | undefined,
  settle: boolean,
) {
  const head = `Window "${title ?? "Chromium"}" (click_element{n} clicks [n]):${page ? `\nURL: ${page.url.slice(0, 400)}` : ""}`;
  // A tab that never left about:blank (a navigate that did not land, a Chromium restart) must not read as an empty page.
  const blank = page?.url === "about:blank" ? `${BLANK_TAB}\n` : "";
  const screen = `${blank}${head}\n${body}`.slice(0, settle ? 6000 : 12_000);
  if (settle || !page?.links.length) return screen;
  const links = page.links.map((l) => `- ${l.text || "(no text)"} -> ${l.href}`).join("\n");
  return `${screen}\nLinks on the page (text -> address):\n${links}`.slice(0, screen.length + 6000);
}
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
/** `ZETTA_DESKTOP_RUNTIME=docker` turns on per-user VMs; the rest tunes the container. */
export function dockerVmConfig(env: NodeJS.ProcessEnv = process.env): VmDocker | undefined {
  if (env.ZETTA_DESKTOP_RUNTIME !== "docker") return undefined;
  return {
    bin: env.ZETTA_DOCKER_BIN ?? "docker",
    image: env.ZETTA_VM_IMAGE ?? "zetta-desktop:latest",
    images: { ubuntu: env.ZETTA_VM_IMAGE_UBUNTU || "zetta-desktop-ubuntu:latest" },
    memory: env.ZETTA_VM_MEMORY ?? "2g",
    cpus: env.ZETTA_VM_CPUS ?? "2",
    pids: envNumber(env.ZETTA_VM_PIDS, 1024),
    shm: env.ZETTA_VM_SHM ?? "1g",
    runtime: env.ZETTA_VM_RUNTIME || undefined,
    network: env.ZETTA_VM_NETWORK || undefined,
  };
}
/** `ZETTA_VM_DRIVERS=cua,agent-desktop`: the drivers an operator offers. Unknown names are dropped; empty means cua only. */
export function vmDriversFrom(raw: string | undefined): DriverName[] {
  const named = (raw ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x): x is DriverName => (DRIVERS as readonly string[]).includes(x));
  return named.length ? [...new Set(named)] : ["cua"];
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
    // Chromium's DevTools port (socat in the image): the server reads the page address and its links from it (see pageLinks).
    "-p",
    "127.0.0.1::9222",
    d.image,
  ];
}

export function createCliExec(bin: string): VmExec {
  return async (args, opts) => {
    const timer = opts?.timeout ? AbortSignal.timeout(opts.timeout) : undefined;
    const signals = [opts?.signal, timer].filter((x): x is AbortSignal => Boolean(x));
    const p = Bun.spawn([bin, ...args], {
      stdout: "pipe",
      stderr: "ignore",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
    });
    const stdout = await new Response(p.stdout).text();
    const code = await p.exited;
    if (timer?.aborted && !opts?.signal?.aborted) throw new ComputerError("SLOW");
    return { code, stdout };
  };
}

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
            ...(v.target ? { target: v.target } : {}),
            ...(v.driver ? { driver: v.driver } : {}),
            ...(v.os ? { os: v.os } : {}),
            ...(v.endpoint ? { endpoint: v.endpoint } : {}),
            ...(v.connectionId ? { connectionId: v.connectionId } : {}),
          })
          .returning()
      )[0]!,
    setDriver: async (userId, id, driver) => {
      await db
        .update(computerVm)
        .set({ driver })
        .where(and(live(userId), eq(computerVm.id, id)));
    },
    count: async (userId) =>
      (await db.select({ id: computerVm.id }).from(computerVm).where(live(userId))).length,
    setStatus: async (id, status) => {
      await db
        .update(computerVm)
        .set({
          status,
          ownerInstance: status === "running" ? instanceId() : null,
          ...(status === "running" ? { lastStartedAt: new Date() } : {}),
          ...(status === "deleted" ? { deletedAt: new Date() } : {}),
        })
        .where(eq(computerVm.id, id));
    },
    // Called by the boot sweep, which also stops the containers of this host: VMs of a dead owner and VMs recorded before owners existed.
    resetRunning: async () => {
      await db
        .update(computerVm)
        .set({ status: "stopped", ownerInstance: null })
        .where(
          and(
            eq(computerVm.status, "running"),
            recoverable(computerVm.ownerInstance, { unowned: true }),
          ),
        );
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
  /** Drivers a person may pick for a VM (default: cua). agent-desktop joins once the image ships it. */
  vmDrivers?: readonly DriverName[];
  /** Systems a person may pick for a new computer (default: debian). Each needs its image built. */
  vmOs?: readonly OsId[];
  /** Reads the page address and links over the DevTools port; injectable so tests do not need Chromium. */
  links?: (port: number) => Promise<PageLinks>;
  /** Opens an address over the DevTools port and waits for the load; injectable so tests do not need Chromium. */
  navigate?: (port: number, url: string, o?: { signal?: AbortSignal }) => Promise<NavigateResult>;
  /** Waits for the page on screen to finish drawing before a read (false: it was still changing). Tests replace it. */
  settle?: (port: number, o?: { maxMs?: number; signal?: AbortSignal }) => Promise<boolean>;
  /** Where the bearer token of a remote Cua computer is kept (sealed in the connections store). Without it, remote computers are off. */
  secrets?: VmSecrets;
  connectRemote?: RemoteConnect;
  /** "network": this machine's own desktop is never offered (see placement.ts). Default "network", the safe side. */
  install?: InstallMode;
  /** Drives this machine's own desktop (target "local"), one factory per driver installed here. Without any, or on a network install,
   * the target is off. */
  host?: Partial<Record<DriverName, () => DesktopDriver>>;
  /** False when there is no container runtime: only remote computers and this machine are offered. Default true. */
  vmOn?: boolean;
};
/** The sealed token of a remote computer. `read` throws a `ComputerError` REVOKED when it is gone. */
export type VmSecrets = {
  create(userId: string, label: string, secret: string): Promise<string>;
  read(userId: string, connectionId: string): Promise<string>;
  revoke(userId: string, connectionId: string): Promise<void>;
};
export function createVmService({
  store,
  docker,
  exec = createCliExec(docker.bin),
  install = "network",
  host,
  vmOn = true,
  connect = connectSpacesd,
  connectRemote = connectSpacesdUrl,
  secrets,
  links = pageLinks,
  navigate = navigatePage,
  settle = settlePage,
  tokenRoot,
  maxPerUser = 4,
  maxRunningPerUser = 2,
  maxRunning = 6,
  idleMs = 15 * 60_000,
  allowPrivate = false,
  vmDrivers = ["cua"],
  vmOs = ["debian"],
}: VmOptions) {
  const hostDrivers = (Object.keys(host ?? {}) as DriverName[]).filter((d) => host?.[d]);
  const hostOn =
    hostDrivers.length > 0 &&
    desktopTargets(install, { vm: false, remote: false, host: true }).includes("local");
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
    void s.close().catch(() => undefined);
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
      target: row.target,
      driver: row.driver,
      os: row.os,
      endpoint: row.endpoint,
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

  /** Connects the row's driver to a running container. Cua talks to spacesd; agent-desktop runs a command in the container per call. */
  async function attach(
    driver: DriverName,
    os: OsId,
    id: string,
    port: number,
    token: string,
    attempts?: number,
  ) {
    const browser = hasBrowser(os);
    if (driver === "cua") {
      const client = await connect(port, token, attempts);
      return { driver: createCuaDriver(client.call, { browser }), close: client.close, browser };
    }
    return {
      driver: createAgentDesktopDriver(
        {
          cli: (args, o) => exec(["exec", container(id), "zetta-agent-desktop", ...args], o),
          xdotool: (args, o) => exec(["exec", container(id), "xdotool", ...args], o),
        },
        { browser },
      ),
      close: async () => {},
      browser,
    };
  }
  /** The image a computer runs: Debian's is the default image; another system's is its own, never Debian's. */
  const imageOf = (os: OsId) =>
    os === "debian" ? docker.image : (docker.images?.[os] ?? `zetta-desktop-${os}:latest`);

  /** Each user's default VM id, so the hot path (a bot acting on a running VM) skips the database. */
  const defaults = new Map<string, string>();
  /** Only an https address with no credentials, path or query; a private one only when the operator allows private networks. */
  async function assertEndpoint(raw: string): Promise<string> {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new ComputerError("INVALID");
    }
    if (u.protocol !== "https:" && !(u.protocol === "http:" && allowPrivate))
      throw new ComputerError("INSECURE");
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
      throw new ComputerError("INVALID");
    if (!allowPrivate) await assertPublicUrl(u.href);
    return u.origin;
  }
  /** A computer on another machine that runs cua-spacesd: connect with the stored bearer token. Nothing runs on this host. */
  async function startRemote(userId: string, row: VmRow) {
    if (!secrets || !row.endpoint || !row.connectionId) throw new ComputerError("UNSUPPORTED");
    if ([...sessions.values()].filter((s) => s.userId === userId).length >= maxRunningPerUser)
      throw new ComputerError("LIMIT");
    try {
      // Checked at every start: a name that pointed at a public address when it was saved may point somewhere private now.
      await assertEndpoint(row.endpoint);
      const client = await connectRemote(
        row.endpoint,
        await secrets.read(userId, row.connectionId),
      );
      // No browser is assumed on someone else's machine: navigate and sign-in fill stay off, the other actions work.
      const driver = createCuaDriver(client.call, { browser: false });
      await driver.ready().catch(async (e: unknown) => {
        await client.close().catch(() => undefined);
        throw e;
      });
      sessions.set(row.id, {
        id: row.id,
        userId,
        port: 0,
        remote: true,
        viewers: 0,
        keyboard: "us",
        close: client.close,
        driver,
        browser: false,
        cdp: null,
        control: "agent",
        epoch: 0,
        lastUsed: Date.now(),
        queue: Promise.resolve(),
        row: { ...row, status: "running" },
      });
      await store.setStatus(row.id, "running");
      return view({ ...row, status: "running" });
    } catch (e) {
      await store.setStatus(row.id, "failed");
      throw e instanceof ComputerError ? e : new ComputerError("UNAVAILABLE");
    }
  }
  /** This machine's own desktop (a local install only). Nothing is started: the driver acts on the screen the person is using. */
  async function startLocal(userId: string, row: VmRow) {
    if (!hostOn)
      throw new ComputerError(
        "UNSUPPORTED",
        "This computer's own desktop is only offered when Zetta runs on it.",
      );
    const make = host?.[row.driver as DriverName] ?? host?.[hostDrivers[0]!];
    const driver = make!();
    await driver.ready();
    sessions.set(row.id, {
      id: row.id,
      userId,
      port: 0,
      remote: true,
      viewers: 0,
      keyboard: "us",
      close: async () => {},
      driver,
      // navigate opens the person's own default browser (the address is still checked first).
      browser: true,
      cdp: null,
      control: "agent",
      epoch: 0,
      lastUsed: Date.now(),
      queue: Promise.resolve(),
      row: { ...row, status: "running" },
    });
    await store.setStatus(row.id, "running");
    return view({ ...row, status: "running" });
  }
  /** Starts the user's VM (the default one when no id is given). One start at a time per user, so caps cannot be raced. */
  const start = (userId: string, vmId?: string) => {
    const hot = sessions.get(vmId ?? defaults.get(userId) ?? "");
    if (hot?.row && hot.userId === userId) {
      hot.lastUsed = Date.now();
      return Promise.resolve(view(hot.row));
    }
    return serial(userId, async () => {
      const row = vmId ? await owned(userId, vmId) : await store.ensureDefault(userId);
      if (!vmId) defaults.set(userId, row.id);
      const existing = sessions.get(row.id);
      if (existing) {
        existing.lastUsed = Date.now();
        existing.row = { ...row, status: "running" };
        return view(row);
      }
      if (row.target === "cua") return startRemote(userId, row);
      if (row.target === "local") return startLocal(userId, row);
      if (!vmOn) throw new ComputerError("UNSUPPORTED");
      // A computer keeps the driver it was given; if the operator has since turned that driver off, it does not start under another one.
      if (!vmDrivers.includes(row.driver)) throw new ComputerError("UNSUPPORTED");
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
          exec(["image", "inspect", "--format", "{{.Id}}", imageOf(row.os)]),
        ]);
        const [image, running] = had.stdout.trim().split(/\s+/);
        const current = had.code === 0 && want.code === 0 && image === want.stdout.trim();
        // Still running with no session here (a hot reload, another server process, a restart): reattach with the token it already has.
        // Restarting it instead would kill whatever another process (or the previous module instance) is doing on it right now.
        if (current && running === "true") {
          const back = await reattach(row.id, userId, row.driver, row.os, tokenFile, vncFile);
          if (back) {
            orphans.delete(row.id);
            await store.setStatus(row.id, "running");
            back.row = { ...row, status: "running" };
            return view(back.row);
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
          (
            await exec(
              vmDockerArgs(
                { ...docker, image: imageOf(row.os) },
                { id: row.id, tokenFile, vncFile },
              ),
            )
          ).code !== 0
        )
          throw new ComputerError("UNAVAILABLE");
        const [port, vncPort] = await Promise.all([portOf(row.id, 3211), portOf(row.id, 5900)]);
        const { driver, close, browser } = await attach(row.driver, row.os, row.id, port, token);
        await driver.ready();
        sessions.set(row.id, {
          id: row.id,
          userId,
          port,
          vnc: { port: vncPort, password },
          viewers: 0,
          keyboard: "us",
          close,
          driver,
          browser,
          control: "agent",
          epoch: 0,
          lastUsed: Date.now(),
          queue: Promise.resolve(),
          row: { ...row, status: "running" },
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
  };

  /** A session for a container that is already running, from the token and VNC password on disk; undefined when they no longer work. */
  async function reattach(
    id: string,
    userId: string,
    driverName: DriverName,
    os: OsId,
    tokenFile: string,
    vncFile: string,
  ) {
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
    // ~5 s of health checks: spacesd may be busy for a moment, and giving up here restarts the container (open tabs are lost).
    const attached = await attach(driverName, os, id, ports[0], token, 20).catch(() => undefined);
    if (!attached) return undefined;
    const { driver, close, browser } = attached;
    if (!(await driver.probe().catch(() => false))) {
      await close().catch(() => undefined);
      return undefined;
    }
    const s: VSession = {
      id,
      userId,
      port: ports[0],
      vnc: { port: ports[1], password },
      viewers: 0,
      keyboard: "us",
      close,
      driver,
      browser,
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

  /** The published DevTools port, looked up once; null when the VM's image has none (started before it was added). */
  async function devtools(s: VSession) {
    if (s.cdp === undefined) s.cdp = await portOf(s.id, 9222).catch(() => null);
    return s.cdp;
  }

  function act(
    userId: string,
    id: string,
    by: Actor,
    action: VmAction,
    opts: { signal?: AbortSignal; epoch?: number } = {},
  ): Promise<{
    id: string;
    control: "agent" | "human";
    epoch: number;
    /** navigate only: the address the tab ended on, and whether its load event fired (false: still loading). */
    url?: string;
    loaded?: boolean;
  }> {
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
        if (action.type === "launch" && !SAFE_APP.test(action.app))
          throw new ComputerError("INVALID");
        if (action.type === "navigate") {
          if (!s.browser) throw new ComputerError("UNSUPPORTED"); // this system's image has no browser
          // The address is checked first, like browser sessions.
          assertWebScheme(action.url);
          if (!allowPrivate) await assertPublicUrl(action.url);
          // Through the DevTools port the bot learns where the tab landed or why it did not. Typing in the address bar is blind: it
          // reports success when the keys went to another window, or while Chromium is still starting.
          const port = await devtools(s);
          if (port !== null) {
            try {
              const at = await navigate(port, action.url, { signal: opts.signal });
              s.lastUsed = Date.now();
              return { id: s.id, control: s.control, epoch: s.epoch, ...at };
            } catch (e) {
              if (e instanceof NavigationError)
                throw new ComputerError("NAVIGATION_FAILED", e.message);
              if (opts.signal?.aborted) throw new ComputerError("CANCELLED");
              // DevTools did not answer (Chromium restarting): the address bar still works.
            }
          }
        }
        await s.driver.act(action, { signal: opts.signal });
        s.lastUsed = Date.now();
        return { id: s.id, control: s.control, epoch: s.epoch };
      });
    });
    s.queue = run.catch(() => undefined);
    return run;
  }

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
        if (!s.browser) throw new ComputerError("UNSUPPORTED");
        const done = await s.driver.fillCredential(field, reveal);
        s.lastUsed = Date.now();
        return done;
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
    await s.close().catch(() => undefined);
    if (s.remote) {
      await store.setStatus(id, "stopped");
      return;
    }
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
      v: {
        name: string;
        purpose?: string | null;
        botId?: string | null;
        target?: VmTarget;
        driver?: DriverName;
        os?: OsId;
      },
    ) {
      if (!SAFE_NAME.test(v.name)) throw new ComputerError("INVALID");
      if (v.os && !vmOs.includes(v.os)) throw new ComputerError("UNSUPPORTED");
      // A VM, or this machine's own desktop on a local install (see placement.ts); the driver must be one the operator allows.
      if (v.target === "local") {
        if (!hostOn) throw new ComputerError("UNSUPPORTED");
        if (v.driver && !hostDrivers.includes(v.driver)) throw new ComputerError("UNSUPPORTED");
        v = { ...v, driver: v.driver ?? hostDrivers[0]! };
      } else {
        if (v.target && v.target !== "vm") throw new ComputerError("UNSUPPORTED");
        if (!vmOn) throw new ComputerError("UNSUPPORTED");
        if (v.driver && !vmDrivers.includes(v.driver)) throw new ComputerError("UNSUPPORTED");
      }
      return serial(userId, async () => {
        await store.ensureDefault(userId);
        if ((await store.count(userId)) >= maxPerUser) throw new ComputerError("LIMIT");
        return view(await store.create(userId, v));
      });
    },
    /**
     * Adds a computer that runs on another machine (cua-spacesd, reached by https with a bearer token). The token is sealed at once;
     * the row holds the address and the id of the sealed token, never the token.
     */
    async createRemote(
      userId: string,
      v: { name: string; endpoint: string; token: string; botId?: string | null },
    ) {
      if (!secrets) throw new ComputerError("UNSUPPORTED");
      if (!SAFE_NAME.test(v.name) || v.token.length < 8 || v.token.length > 8000)
        throw new ComputerError("INVALID");
      const endpoint = await assertEndpoint(v.endpoint);
      return serial(userId, async () => {
        await store.ensureDefault(userId);
        if ((await store.count(userId)) >= maxPerUser) throw new ComputerError("LIMIT");
        const connectionId = await secrets.create(userId, v.name, v.token);
        try {
          return view(
            await store.create(userId, {
              name: v.name,
              botId: v.botId ?? null,
              target: "cua",
              endpoint,
              connectionId,
            }),
          );
        } catch (e) {
          await secrets.revoke(userId, connectionId).catch(() => undefined);
          throw e;
        }
      });
    },
    /** Switches the driver of a stopped computer; a running one keeps the driver it started with. */
    async setDriver(userId: string, id: string, driver: DriverName) {
      const target = (await owned(userId, id)).target;
      const allowed = target === "vm" ? vmDrivers : target === "local" && hostOn ? hostDrivers : [];
      if (!allowed.includes(driver)) throw new ComputerError("UNSUPPORTED");
      if (sessions.has(id)) throw new ComputerError("LIMIT");
      await store.setDriver(userId, id, driver);
    },
    /** What a person may choose when they create or edit a computer. */
    options: () => ({
      targets: {
        vm: vmOn ? [...vmDrivers] : ([] as DriverName[]),
        local: hostOn ? [...hostDrivers] : ([] as DriverName[]),
        cua: secrets ? (["cua"] as DriverName[]) : ([] as DriverName[]),
      },
      os: osOptions(vmOs),
    }),
    /** Deleting destroys the container AND its home volume (sign-ins, downloads). The default VM is recreated empty on next use. */
    async remove(userId: string, id: string) {
      const row = await owned(userId, id);
      await stop(userId, id);
      if (row.target === "local") {
        // This machine is not ours to destroy: only the row goes.
        await store.setStatus(id, "deleted");
        return;
      }
      if (row.target === "cua") {
        // Nothing of a remote computer lives here except its sealed token.
        if (row.connectionId)
          await secrets?.revoke(userId, row.connectionId).catch(() => undefined);
        await store.setStatus(id, "deleted");
        return;
      }
      await exec(["rm", "-f", container(id)]).catch(() => undefined);
      await exec(["volume", "rm", "-f", container(id)]).catch(() => undefined);
      await store.setStatus(id, "deleted");
    },
    async screenshot(userId: string, id: string) {
      const s = live(userId, id);
      return guard(s, () => s.driver.screenshot());
    },
    /**
     * Text view for bots that cannot see images: Chromium's accessibility tree with clickable elements numbered for click_element.
     * `settle` (right after an action) waits briefly for the page to change and reads a smaller tree; an explicit read gets the full one.
     */
    async read(userId: string, id: string, opts: { settle?: boolean; signal?: AbortSignal } = {}) {
      const s = live(userId, id);
      return guard(s, async () => {
        // A VM from an older image publishes no DevTools port, and a page may not answer: the read goes on without it.
        const port = await devtools(s);
        // A single-page app draws after the load event: reading at once returns its header and no content (a bot reported X "blocked").
        const settled =
          port === null
            ? true
            : await settle(port, { maxMs: opts.settle ? 2500 : 4000, signal: opts.signal }).catch(
                () => true,
              );
        const r = await s.driver.read(opts);
        if (r.kind === "plain") return r.text;
        const page = port === null ? undefined : await links(port).catch(() => undefined);
        const text = formatRead(r.title, r.body, page, Boolean(opts.settle));
        return settled ? text : `${text}\n${STILL_LOADING}`;
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
      if (live(userId, id).remote) throw new ComputerError("UNSUPPORTED");
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
      if (s.remote) throw new ComputerError("UNSUPPORTED");
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
      if (live(userId, id).remote) throw new ComputerError("UNSUPPORTED");
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
      if (!s.vnc) throw new ComputerError("UNSUPPORTED");
      const vnc = s.vnc;
      s.viewers++;
      let released = false;
      return {
        userId: t.userId,
        port: vnc.port,
        password: vnc.password,
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
      for (const s of sessions.values()) void s.close().catch(() => undefined);
      sessions.clear();
    },
  };
}
export type VmService = ReturnType<typeof createVmService>;

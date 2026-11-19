import { hostname as osHostname } from "node:os";
import type { Registry } from "../registry";
import type { TokenStore } from "../token-store";
import { listFolder, runCommand, type ExecResult } from "./exec";
import type { Approvals } from "./approvals";
import { guardedWords, type Grants } from "./policy";

/** The part of a WebSocket the client uses; tests replace it. */
export type SocketLike = {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};
export type SocketFactory = (url: string, credential: string) => SocketLike;

const bunSocket: SocketFactory = (url, credential) =>
  new WebSocket(url, {
    headers: { authorization: `Bearer ${credential}` },
  } as never) as unknown as SocketLike;

export type CompanionState = {
  /** The person turned sharing on for this server. */
  enabled: boolean;
  /** The server holds a live connection from this computer. */
  connected: boolean;
  paused: boolean;
};

/** A name the server accepts (`[letters digits space . _ -]`, 60 at most), from this computer's host name. */
export function deviceNameFrom(host: string): string {
  const cleaned = host
    .replace(/\.local$/i, "")
    .replace(/[^\p{L}\p{N} ._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || "My computer";
}

export type CompanionDeps = {
  registry: Registry;
  tokens: TokenStore;
  grants: Grants;
  approvals: Approvals;
  /** An access token that is good now for a server, or null. Needed once, to pair. */
  accessToken(serverId: string): Promise<string | null>;
  fetcher?: typeof fetch;
  socket?: SocketFactory;
  hostname?: () => string;
  platform?: () => string;
  run?: typeof runCommand;
  list?: typeof listFolder;
  sleep?: (ms: number) => Promise<void>;
  pingMs?: number;
  /** A request needs the person: bring the window forward. */
  attention?: () => void;
  onChange?: () => void;
};

const toSocketUrl = (apiOrigin: string) =>
  `${apiOrigin.replace(/^http/, "ws")}/api/devices/connect`;

/**
 * Lets a remote Zetta server's bots work on this computer, with the person here in charge.
 * - Sharing is a choice per server. Turning it on pairs this computer (once, with the sign-in the app already has) and opens a connection
 *   to the server; the server sends requests, never the other way round, and nothing is reachable from outside.
 * - Every request is checked here, not trusted from the server: a bot the person has not allowed asks first, deletes/root/mail always ask,
 *   and a request nobody answers is refused. Pausing refuses everything and drops the connections.
 */
export function createCompanion(deps: CompanionDeps) {
  const { registry, tokens, grants, approvals, fetcher = fetch, socket: open = bunSocket } = deps;
  const run = deps.run ?? runCommand;
  const list = deps.list ?? listFolder;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const hostnameOf = deps.hostname ?? osHostname;
  const platformOf = deps.platform ?? (() => process.platform);
  const live = new Map<
    string,
    { socket: SocketLike; ping: ReturnType<typeof setInterval> | undefined }
  >();
  /** Servers whose connection is open right now. */
  const up = new Set<string>();
  /** Servers whose connection should be kept up (sharing on, not paused). */
  const wanted = new Set<string>();
  let paused = false;
  const changed = () => deps.onChange?.();

  const reply = (
    socket: SocketLike,
    id: string,
    body: { result: ExecResult } | { error: { code: string } },
  ) => {
    try {
      socket.send(JSON.stringify({ id, ...body }));
    } catch {}
  };

  async function handle(serverId: string, socket: SocketLike, raw: unknown) {
    let message: { id?: unknown; method?: unknown; params?: unknown };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (typeof message.id !== "string") return;
    const id = message.id;
    const params = (
      message.params && typeof message.params === "object" ? message.params : {}
    ) as Record<string, unknown>;
    if (paused || !wanted.has(serverId)) return reply(socket, id, { error: { code: "DENIED" } });
    if (message.method !== "run" && message.method !== "list")
      return reply(socket, id, { error: { code: "UNSUPPORTED" } });

    const method = message.method;
    const detail = String(method === "run" ? (params.command ?? "") : (params.path ?? "")).slice(
      0,
      2_000,
    );
    if (!detail) return reply(socket, id, { error: { code: "UNSUPPORTED" } });
    const botId = typeof params.botId === "string" ? params.botId : "";
    const guarded = method === "run" ? guardedWords(detail) : [];
    if (!botId || guarded.length || !grants.allows(serverId, botId)) {
      deps.attention?.();
      const decision = await approvals.ask({
        serverName: registry.get(serverId)?.name ?? "A Zetta server",
        bot: String(params.bot ?? "a bot").slice(0, 80),
        method,
        detail,
        guarded,
      });
      if (decision === "deny" || paused || !wanted.has(serverId))
        return reply(socket, id, { error: { code: "DENIED" } });
      if (decision === "always" && botId) grants.allow(serverId, botId);
    }
    reply(socket, id, { result: method === "run" ? await run(detail) : await list(detail) });
  }

  function connect(serverId: string, attempt = 0) {
    const entry = registry.get(serverId);
    const device = tokens.getDevice(serverId);
    if (!entry || !device?.enabled || paused || !wanted.has(serverId) || live.has(serverId)) return;
    const socket = open(toSocketUrl(entry.apiOrigin), device.credential);
    let opened = false;
    const record = { socket, ping: undefined as ReturnType<typeof setInterval> | undefined };
    live.set(serverId, record);
    socket.onopen = () => {
      opened = true;
      up.add(serverId);
      record.ping = setInterval(() => {
        try {
          socket.send("ping");
        } catch {}
      }, deps.pingMs ?? 20_000);
      (record.ping as { unref?: () => void }).unref?.();
      changed();
    };
    socket.onmessage = (event) => void handle(serverId, socket, event.data);
    socket.onclose = () => {
      if (record.ping) clearInterval(record.ping);
      if (live.get(serverId) === record) {
        live.delete(serverId);
        up.delete(serverId);
      }
      changed();
      if (!wanted.has(serverId) || paused) return;
      // Try again: quickly after a connection that had worked, slower while the server is not answering.
      const wait = opened ? 1_000 : Math.min(2_000 * 2 ** attempt, 60_000);
      void sleep(wait).then(() => connect(serverId, opened ? 0 : attempt + 1));
    };
    socket.onerror = () => {};
  }

  function disconnect(serverId: string) {
    const record = live.get(serverId);
    if (!record) return;
    live.delete(serverId);
    up.delete(serverId);
    if (record.ping) clearInterval(record.ping);
    try {
      record.socket.close();
    } catch {}
  }

  /** Pairs this computer with a server it is signed in to. Returns false when the server did not accept it. */
  async function pair(serverId: string): Promise<boolean> {
    const entry = registry.get(serverId);
    const token = entry ? await deps.accessToken(serverId) : null;
    if (!entry || !token) return false;
    try {
      const res = await fetcher(`${entry.apiOrigin}/api/devices`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: deviceNameFrom(hostnameOf()), platform: platformOf() }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { device?: { id?: unknown }; credential?: unknown };
      if (typeof body.device?.id !== "string" || typeof body.credential !== "string") return false;
      tokens.setDevice(serverId, {
        deviceId: body.device.id,
        credential: body.credential,
        enabled: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    get paused() {
      return paused;
    },
    state(serverId: string): CompanionState {
      return {
        enabled: Boolean(tokens.getDevice(serverId)?.enabled),
        connected: up.has(serverId) && wanted.has(serverId),
        paused,
      };
    },
    states(): Record<string, CompanionState> {
      return Object.fromEntries(
        registry
          .list()
          .filter((e) => e.kind === "remote")
          .map((e) => [e.id, this.state(e.id)]),
      );
    },
    /** Turns sharing on for a server: pairs if this computer is not yet, then connects. */
    async enable(serverId: string): Promise<boolean> {
      const known = tokens.getDevice(serverId);
      if (known) tokens.setDevice(serverId, { ...known, enabled: true });
      else if (!(await pair(serverId))) return false;
      wanted.add(serverId);
      connect(serverId);
      changed();
      return true;
    },
    /** Turns sharing off: the connection closes, what waits is refused, and what was allowed is forgotten. */
    disable(serverId: string): void {
      const known = tokens.getDevice(serverId);
      if (known) tokens.setDevice(serverId, { ...known, enabled: false });
      wanted.delete(serverId);
      disconnect(serverId);
      grants.revokeServer(serverId);
      approvals.denyAll();
      changed();
    },
    /** Pause or resume every server at once (the tray item). */
    setPaused(next: boolean): void {
      paused = next;
      if (next) {
        for (const serverId of live.keys()) disconnect(serverId);
        approvals.denyAll();
      } else for (const serverId of wanted) connect(serverId);
      changed();
    },
    /** Opens the connections of every server the person turned sharing on for. */
    start(): void {
      for (const entry of registry.list()) {
        if (
          entry.kind !== "remote" ||
          !tokens.getDevice(entry.id)?.enabled ||
          !tokens.get(entry.id)
        )
          continue;
        wanted.add(entry.id);
        connect(entry.id);
      }
    },
    /** The sign-in to a server ended: its sharing ends with it. */
    forget(serverId: string): void {
      this.disable(serverId);
    },
    stop(): void {
      wanted.clear();
      for (const serverId of live.keys()) disconnect(serverId);
      approvals.denyAll();
    },
  };
}
export type Companion = ReturnType<typeof createCompanion>;

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeOrigin } from "@zetta/core/server-meta";
import { uuidv7 } from "@zetta/core/uuid";

/** `remote`: a server someone typed in. `local`: the one this app runs on this computer. `dev`: the web dev server of this repository. */
export const serverKinds = ["remote", "local", "dev"] as const;
export type ServerKind = (typeof serverKinds)[number];

export type ServerEntry = {
  id: string;
  name: string;
  kind: ServerKind;
  /** Where the window opens. The bridge and the cookie jar are tied to it. */
  webOrigin: string;
  apiOrigin: string;
  lastOpenedAt: string | null;
};

export type NewServer = { name?: string; kind: ServerKind; webOrigin: string; apiOrigin: string };

type Stored = { version: 1; servers: ServerEntry[] };

const isKind = (value: unknown): value is ServerKind => serverKinds.includes(value as ServerKind);

function parseEntry(value: unknown): ServerEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const webOrigin = normalizeOrigin(row.webOrigin);
  const apiOrigin = normalizeOrigin(row.apiOrigin);
  if (typeof row.id !== "string" || !row.id || !webOrigin || !apiOrigin || !isKind(row.kind))
    return null;
  const name =
    typeof row.name === "string" && row.name.trim()
      ? row.name.trim().slice(0, 80)
      : new URL(webOrigin).host;
  const lastOpenedAt = typeof row.lastOpenedAt === "string" ? row.lastOpenedAt : null;
  return { id: row.id, name, kind: row.kind, webOrigin, apiOrigin, lastOpenedAt };
}

/**
 * The servers this app knows, kept in one JSON file in the app's user-data folder.
 * A file that cannot be read is moved aside (never overwritten) and the list starts empty, so a bad write cannot cost anyone their list.
 */
export function createRegistry(file: string, now: () => Date = () => new Date()) {
  let servers: ServerEntry[] = [];

  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    const body: Stored = { version: 1, servers };
    writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  };

  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { servers?: unknown };
      if (!Array.isArray(parsed.servers)) throw new Error("no servers list");
      servers = parsed.servers
        .map(parseEntry)
        .filter((entry): entry is ServerEntry => entry !== null);
    } catch {
      renameSync(file, `${file}.corrupt-${now().getTime()}`);
    }
  }

  return {
    list: (): ServerEntry[] => servers.map((entry) => ({ ...entry })),
    get: (id: string): ServerEntry | undefined => servers.find((entry) => entry.id === id),
    findByOrigin(origin: string): ServerEntry | undefined {
      const wanted = normalizeOrigin(origin);
      return wanted
        ? servers.find((entry) => entry.webOrigin === wanted || entry.apiOrigin === wanted)
        : undefined;
    },
    /** Adds a server, or refreshes the one that already has this web origin (its id, name and history stay). */
    add(input: NewServer): ServerEntry {
      const webOrigin = normalizeOrigin(input.webOrigin);
      const apiOrigin = normalizeOrigin(input.apiOrigin);
      if (!webOrigin || !apiOrigin || !isKind(input.kind)) throw new Error("INVALID_SERVER");
      const existing = servers.find((entry) => entry.webOrigin === webOrigin);
      if (existing) {
        existing.apiOrigin = apiOrigin;
        save();
        return { ...existing };
      }
      const entry: ServerEntry = {
        id: uuidv7(),
        name: input.name?.trim().slice(0, 80) || new URL(webOrigin).host,
        kind: input.kind,
        webOrigin,
        apiOrigin,
        lastOpenedAt: null,
      };
      servers = [...servers, entry];
      save();
      return { ...entry };
    },
    rename(id: string, name: string): boolean {
      const entry = servers.find((row) => row.id === id);
      if (!entry || !name.trim()) return false;
      entry.name = name.trim().slice(0, 80);
      save();
      return true;
    },
    touch(id: string): void {
      const entry = servers.find((row) => row.id === id);
      if (!entry) return;
      entry.lastOpenedAt = now().toISOString();
      save();
    },
    remove(id: string): boolean {
      const before = servers.length;
      servers = servers.filter((entry) => entry.id !== id);
      if (servers.length === before) return false;
      save();
      return true;
    },
  };
}

/**
 * The other servers whose cookies this one would overwrite. Cookies are kept per host and not per port (see windows.ts), and every Zetta
 * server names its session cookie the same, so signing in to one of them signs the other out.
 */
export function sharesCookiesWith(
  servers: readonly ServerEntry[],
  entry: ServerEntry,
): ServerEntry[] {
  const hosts = new Set([new URL(entry.webOrigin).hostname, new URL(entry.apiOrigin).hostname]);
  return servers.filter(
    (other) =>
      other.id !== entry.id &&
      (hosts.has(new URL(other.webOrigin).hostname) ||
        hosts.has(new URL(other.apiOrigin).hostname)),
  );
}

export type Registry = ReturnType<typeof createRegistry>;

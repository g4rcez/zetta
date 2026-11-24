// Server settings: the typed values of the registry (@zetta/core/settings) stored in `zetta.setting`, per installation with an optional
// override per organization (workspace). Readers ask `get(key)` on every use, so a change needs no restart.
//
// Freshness: each process keeps the rows of a scope in memory for `ttlMs` (5 seconds). A write made through this process drops its cache at
// once; another process sees the change within `ttlMs`. Nothing is pushed between processes.
import type { Database } from "@zetta/db";
import {
  SETTINGS,
  SETTING_GROUPS,
  effective,
  isSettingKey,
  parseSettingValue,
  settingDefault,
  settingMeta,
  type AnySettingValue,
  type SettingKey,
  type SettingValue,
} from "@zetta/core/settings";
import { AccessError, type ActiveActor } from "../identity/access";
import { createSettingsStore, type SettingScope, type SettingsStore } from "./store";

/** Who asks for a write: a person at the keyboard, or a bot or MCP client acting for one. A sensitive setting refuses the second. */
export type SettingVia = "person" | "bot";
export type SettingSourceView = "organization" | "installation" | "imported" | "default";

export class SettingsError extends Error {
  constructor(
    readonly code: "UNKNOWN_KEY" | "INVALID" | "SENSITIVE" | "SCOPE",
    message: string,
  ) {
    super(message);
  }
}

export type SettingView = Omit<ReturnType<typeof settingMeta>, "key"> & {
  key: SettingKey;
  /** The value that counts now. */
  value: AnySettingValue;
  source: SettingSourceView;
  /** What is stored for the installation (null: nothing stored). */
  installationValue: AnySettingValue | null;
  /** What is stored for the organization asked about (null: nothing stored, or none asked). */
  organizationValue: AnySettingValue | null;
};

export type SettingChange = {
  key: SettingKey;
  change: "set" | "reset";
  scope: "installation" | "organization";
};

type Layer = Map<string, { value: AnySettingValue; imported: boolean }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SETTINGS_CACHE_TTL_MS = 5000;

export type SettingsOptions = {
  /** The database, or a `store` (tests use an in-memory one). */
  db?: Pick<Database, "select" | "insert" | "delete">;
  store?: SettingsStore;
  /** One line per change in the audit trail: the key and the scope, never the value. */
  audit?: (userId: string, change: SettingChange) => void;
  ttlMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
};

export function createSettingsService({
  db,
  store: given,
  audit,
  ttlMs = SETTINGS_CACHE_TTL_MS,
  now = Date.now,
  warn = (m) => console.warn(m),
}: SettingsOptions) {
  const opened = given ?? (db ? createSettingsStore(db) : undefined);
  if (!opened) throw new Error("The settings service needs a database or a store.");
  const store: SettingsStore = opened;
  const cache = new Map<string, { at: number; rows: Layer }>();
  /** Bumped by every local write: a read that started before it must not put its (older) rows in the cache. */
  let generation = 0;
  const warned = new Set<string>();

  const scopeKey = (scope: SettingScope) =>
    scope.kind === "installation" ? "installation" : `workspace:${scope.id}`;

  async function layer(scope: SettingScope): Promise<Layer> {
    const k = scopeKey(scope);
    const hit = cache.get(k);
    if (hit && now() - hit.at < ttlMs) return hit.rows;
    const started = generation;
    const rows: Layer = new Map();
    for (const [key, stored] of await store.readScope(scope)) {
      if (!isSettingKey(key)) continue;
      const parsed = parseSettingValue(key, stored.value);
      if (parsed.ok) rows.set(key, { value: parsed.value, imported: stored.updatedBy === null });
      else if (!warned.has(`${k}:${key}`)) {
        warned.add(`${k}:${key}`);
        warn(`setting ${key} has a stored value that is not valid, so its default is used.`);
      }
    }
    if (started === generation) cache.set(k, { at: now(), rows });
    return rows;
  }
  /** Set once `peek` is used: from then on a dropped cache is refilled at once, so the synchronous answer is not "unknown" for long. */
  let watching = false;
  let refreshing = false;
  function refreshInstallation() {
    if (refreshing) return;
    refreshing = true;
    void layer({ kind: "installation" })
      .catch(() => undefined)
      .finally(() => {
        refreshing = false;
      });
  }
  function invalidate() {
    generation++;
    cache.clear();
    if (watching) refreshInstallation();
  }

  const requireAdmin = (actor: ActiveActor) => {
    if (!actor.isAdmin) throw new AccessError("ACCESS_DENIED");
  };
  const definition = (key: string): SettingKey => {
    if (!isSettingKey(key)) throw new SettingsError("UNKNOWN_KEY", "There is no such setting.");
    return key;
  };
  const organizationScope = (key: SettingKey, organizationId: string | undefined) => {
    if (organizationId === undefined) return undefined;
    if (SETTINGS[key].scope !== "organization")
      throw new SettingsError(
        "SCOPE",
        `"${SETTINGS[key].label}" is one value for the whole server; an organization cannot have its own.`,
      );
    if (!UUID.test(organizationId))
      throw new SettingsError("INVALID", "That is not an organization.");
    return { kind: "workspace", id: organizationId } as const satisfies SettingScope;
  };

  async function resolve<K extends SettingKey>(key: K, organizationId?: string) {
    const def = SETTINGS[key];
    const installation = (await layer({ kind: "installation" })).get(key);
    const organization =
      organizationId && def.scope === "organization"
        ? (await layer({ kind: "workspace", id: organizationId })).get(key)
        : undefined;
    const result = effective(key, {
      installation: installation?.value as SettingValue<K> | undefined,
      organization: organization?.value as SettingValue<K> | undefined,
    });
    const source: SettingSourceView =
      result.source === "installation" && installation?.imported ? "imported" : result.source;
    return { value: result.value, source, installation, organization };
  }

  const view = <K extends SettingKey>(
    key: K,
    r: Awaited<ReturnType<typeof resolve<K>>>,
  ): SettingView => ({
    ...settingMeta(key),
    value: r.value,
    source: r.source,
    installationValue: r.installation?.value ?? null,
    organizationValue: r.organization?.value ?? null,
  });

  const record = (
    actor: ActiveActor,
    key: SettingKey,
    change: "set" | "reset",
    scope: SettingScope | undefined,
  ) => audit?.(actor.userId, { key, change, scope: scope ? "organization" : "installation" });

  async function get<K extends SettingKey>(
    key: K,
    opts: { organizationId?: string } = {},
  ): Promise<SettingValue<K>> {
    return (await resolve(key, opts.organizationId)).value;
  }

  return {
    get,
    /**
     * The value of an installation key **now, without waiting**, for a check that cannot become async (see `codeEnabled`, the vault's
     * address check). It answers from the rows this process last read: fresh for `ttlMs`; past it the old rows still answer while a
     * refresh runs in the background, but only for three more time-to-lives. It answers `undefined` when the rows were never read, were
     * dropped by a write and not yet read again, or the database has not answered for that long. The caller must treat `undefined` as the
     * safe answer ("no"): this is how a security switch fails closed. Call `warm()` once at start so the first answer is not `undefined`.
     */
    peek<K extends SettingKey>(key: K): SettingValue<K> | undefined {
      watching = true;
      const hit = cache.get("installation");
      const age = hit ? now() - hit.at : Number.POSITIVE_INFINITY;
      if (age >= ttlMs) refreshInstallation();
      if (!hit || age >= ttlMs * 4) return undefined;
      return effective(key, {
        installation: hit.rows.get(key)?.value as SettingValue<K> | undefined,
      }).value;
    },
    /**
     * Like `peek`, and also whether an administrator **saved** the value (a stored row, set in Studio or imported from the old variable) or it
     * is only the registry default. For a security switch whose safe default differs from the registry default: see `code-access.ts`.
     */
    peekStored<K extends SettingKey>(
      key: K,
    ): { value: SettingValue<K>; stored: boolean } | undefined {
      watching = true;
      const hit = cache.get("installation");
      const age = hit ? now() - hit.at : Number.POSITIVE_INFINITY;
      if (age >= ttlMs) refreshInstallation();
      if (!hit || age >= ttlMs * 4) return undefined;
      const row = hit.rows.get(key);
      return {
        value: effective(key, { installation: row?.value as SettingValue<K> | undefined }).value,
        stored: row !== undefined,
      };
    },
    /** Reads the installation rows now, so `peek` has an answer. A failure is the caller's to log: `peek` stays `undefined` until a read works. */
    async warm(): Promise<void> {
      watching = true;
      await layer({ kind: "installation" });
    },
    /** The value and where it comes from, for a reader that needs both. */
    resolve: async <K extends SettingKey>(key: K, opts: { organizationId?: string } = {}) => {
      const { value, source } = await resolve(key, opts.organizationId);
      return { value, source };
    },
    async getMany<K extends SettingKey>(
      keys: readonly K[],
      opts: { organizationId?: string } = {},
    ): Promise<{ [P in K]: SettingValue<P> }> {
      const out = {} as { [P in K]: SettingValue<P> };
      for (const key of keys) out[key] = await get(key, opts);
      return out;
    },
    /** A reader a caller can hold: `const live = settings.reader("claudeLiveInput"); if ((await live()) === "on") ...`. It queries at most once per time-to-live. */
    reader:
      <K extends SettingKey>(key: K, opts: { organizationId?: string } = {}) =>
      () =>
        get(key, opts),

    /** Every key with its value, where the value comes from, and what is stored. Administrators only. */
    async list(
      actor: ActiveActor,
      opts: { organizationId?: string } = {},
    ): Promise<{ groups: typeof SETTING_GROUPS; settings: SettingView[] }> {
      requireAdmin(actor);
      if (opts.organizationId !== undefined && !UUID.test(opts.organizationId))
        throw new SettingsError("INVALID", "That is not an organization.");
      const settings: SettingView[] = [];
      for (const key of Object.keys(SETTINGS) as SettingKey[])
        settings.push(view(key, await resolve(key, opts.organizationId)));
      return { groups: SETTING_GROUPS, settings };
    },

    /**
     * Saves a value for the installation, or for an organization when `organizationId` is given (organization-scoped keys only). A
     * sensitive key refuses a bot or an MCP client. A `narrow` key refuses an organization value that is not stricter than the
     * installation's.
     */
    async set(
      actor: ActiveActor,
      rawKey: string,
      value: unknown,
      opts: { via: SettingVia; organizationId?: string },
    ): Promise<SettingView> {
      requireAdmin(actor);
      const key = definition(rawKey);
      if (SETTINGS[key].sensitive && opts.via === "bot")
        throw new SettingsError(
          "SENSITIVE",
          `"${SETTINGS[key].label}" is security policy: only a person can change it, not a bot or an MCP client.`,
        );
      const org = organizationScope(key, opts.organizationId);
      const parsed = parseSettingValue(key, value);
      if (!parsed.ok) throw new SettingsError("INVALID", parsed.error);
      if (org && "combine" in SETTINGS[key] && SETTINGS[key].combine === "narrow") {
        const installation = (await layer({ kind: "installation" })).get(key)?.value;
        const kept = effective(key, {
          installation: installation as SettingValue<typeof key> | undefined,
          organization: parsed.value,
        }).value;
        if (JSON.stringify(kept) !== JSON.stringify(parsed.value))
          throw new SettingsError(
            "INVALID",
            `An organization can only be stricter than the server for "${SETTINGS[key].label}": the server's value is ${JSON.stringify(
              installation ?? settingDefault(key),
            )}.`,
          );
      }
      await store.upsert(org ?? { kind: "installation" }, key, parsed.value, actor.userId);
      invalidate();
      record(actor, key, "set", org);
      return view(key, await resolve(key, opts.organizationId));
    },

    /** Removes the stored value, so the installation value (for an organization) or the default (for the installation) counts again. */
    async unset(
      actor: ActiveActor,
      rawKey: string,
      opts: { via: SettingVia; organizationId?: string },
    ): Promise<SettingView> {
      requireAdmin(actor);
      const key = definition(rawKey);
      if (SETTINGS[key].sensitive && opts.via === "bot")
        throw new SettingsError(
          "SENSITIVE",
          `"${SETTINGS[key].label}" is security policy: only a person can change it, not a bot or an MCP client.`,
        );
      const org = organizationScope(key, opts.organizationId);
      const removed = await store.remove(org ?? { kind: "installation" }, key);
      invalidate();
      if (removed) record(actor, key, "reset", org);
      return view(key, await resolve(key, opts.organizationId));
    },

    /** Forgets what this process remembers. A write through this service already does it; the import at start-up and tests use it. */
    invalidate,
  };
}
export type SettingsService = ReturnType<typeof createSettingsService>;

/** What a reader needs of the service: the value of a key. */
export type SettingsReader = Pick<SettingsService, "get">;
/**
 * The value of a key for a module that may be built without the service (a test, a tool). Without one the registry default counts, so
 * a module never reads the environment as a fallback.
 */
export async function readSetting<K extends SettingKey>(
  settings: SettingsReader | undefined,
  key: K,
  opts: { organizationId?: string } = {},
): Promise<SettingValue<K>> {
  return settings ? settings.get(key, opts) : settingDefault(key);
}

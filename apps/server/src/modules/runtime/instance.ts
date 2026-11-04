import { hostname } from "node:os";

import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, eq, inArray, ne, sql, type SQL, type SQLWrapper } from "@zetta/db/query";
import { serverInstance } from "@zetta/db/schema/runtime";

import type { Role } from "../../role";

/**
 * The identity of this server process. Each process has a row in `server_instance` and refreshes its heartbeat from the database
 * clock. Rows that record work in progress carry the id of the instance running them (`owner_instance`), so recovery can tell work of
 * a dead process (to recover) from work of a live peer (to leave alone).
 */
const HEARTBEAT_MS = Number(process.env.ZETTA_HEARTBEAT_MS) || 10_000;
/** An instance with no heartbeat for this long is dead. */
export const DEAD_AFTER_MS = Number(process.env.ZETTA_INSTANCE_DEAD_AFTER_MS) || 90_000;
/** A worker that cannot write its heartbeat for this long stops itself, before its peers start recovering its work. */
const FENCE_AFTER_MS = Number(process.env.ZETTA_FENCE_AFTER_MS) || 60_000;

export type RecoveryScope = {
  /** Also take rows with no owner (written before owners were recorded). Only when no other worker is alive. */
  unowned: boolean;
};

export type Instance = {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  /** Registers this process and starts the heartbeat. */
  start(): Promise<void>;
  /** Marks this process stopped so its work is recovered at once. */
  stop(): Promise<void>;
  /** The scope for a recovery run: at boot, rows without an owner are taken too if no other worker is alive. */
  recoveryScope(boot: boolean): Promise<RecoveryScope>;
};

type Options = {
  db: Pick<Database, "execute" | "insert" | "update" | "select">;
  role: Role;
  name?: string;
  /** Always make a new identity. By default a module reload (`bun --hot`) in the same process keeps the one it had. */
  fresh?: boolean;
  /** Heartbeat interval (default `ZETTA_HEARTBEAT_MS` or 10 s). */
  heartbeatMs?: number;
  /** What to do when this instance was replaced or lost its database for too long. Default: exit, so a supervisor restarts it. */
  onFenced?: (reason: string) => void;
};

// One identity per process: `bun --hot` re-runs modules and must keep the same row and heartbeat.
const holder = globalThis as {
  zettaInstance?: Instance;
  zettaInstanceTimer?: ReturnType<typeof setInterval>;
};
let current: Instance | undefined;

/** The id to write into `owner_instance`. Undefined when no instance is registered (unit tests, scripts). */
export const instanceId = () => current?.id;
export const currentInstance = () => current;
export const setInstance = (instance: Instance | undefined) => {
  current = instance;
};

const legacy = () => process.env.ZETTA_RECOVERY === "legacy";
const deadAfterSeconds = DEAD_AFTER_MS / 1000;

/** SQL: this column names an instance that is dead (stopped, or no heartbeat for a while). */
const deadOwner = (column: SQLWrapper): SQL =>
  sql`not exists (select 1 from ${serverInstance} s where s.id = ${column} and s.stopped_at is null and s.heartbeat_at > now() - make_interval(secs => ${deadAfterSeconds}))`;

/**
 * SQL for the `where` of a recovery that resets work left `running`: the owner is dead, or (when `scope.unowned`) there is no owner.
 * Without a registered instance (unit tests) or with `ZETTA_RECOVERY=legacy` it matches every row, which is the old behaviour.
 */
export function recoverable(column: SQLWrapper, scope: RecoveryScope | undefined): SQL {
  if (!current || legacy()) return sql`true`;
  return scope?.unowned
    ? sql`(${column} is null or ${deadOwner(column)})`
    : sql`(${column} is not null and ${deadOwner(column)})`;
}

export function createInstance({
  db,
  role,
  name,
  fresh,
  heartbeatMs = HEARTBEAT_MS,
  onFenced,
}: Options): Instance {
  const existing = fresh ? undefined : holder.zettaInstance;
  const id = existing?.id ?? uuidv7();
  const label =
    name?.trim() ||
    process.env.ZETTA_INSTANCE_NAME?.trim() ||
    `${hostname()}:${process.env.PORT ?? 3000}`;
  const stopSelf =
    onFenced ??
    ((reason: string) => {
      console.error(`[instance] ${label} stops: ${reason}`);
      process.exit(1);
    });
  // Once: after it fires the heartbeat stops, so the handler is not called again on every beat.
  let fenced = false;
  const fence = (reason: string) => {
    if (fenced) return;
    fenced = true;
    clearInterval(holder.zettaInstanceTimer);
    stopSelf(reason);
  };
  let lastOk = Date.now();

  async function beat() {
    try {
      const rows = await db
        .update(serverInstance)
        .set({ heartbeatAt: sql`now()` })
        .where(and(eq(serverInstance.id, id), sql`${serverInstance.stoppedAt} is null`))
        .returning({ id: serverInstance.id });
      if (rows.length === 0)
        return fence("another process took this instance's name or the row was stopped");
      lastOk = Date.now();
    } catch (e) {
      if (Date.now() - lastOk > FENCE_AFTER_MS)
        fence(
          `no heartbeat for ${Math.round((Date.now() - lastOk) / 1000)} s (${e instanceof Error ? e.message : e})`,
        );
    }
  }

  const instance: Instance = {
    id,
    name: label,
    role,
    async start() {
      // A process with this name that is still listed is its predecessor (a restart) or a twin; the last one to start wins, and a
      // twin finds its row stopped at its next heartbeat and stops itself.
      await db
        .update(serverInstance)
        .set({ stoppedAt: sql`now()` })
        .where(
          and(
            eq(serverInstance.name, label),
            ne(serverInstance.id, id),
            sql`${serverInstance.stoppedAt} is null`,
          ),
        );
      await db
        .insert(serverInstance)
        .values({ id, name: label, role })
        .onConflictDoUpdate({
          target: serverInstance.id,
          set: { name: label, role, heartbeatAt: sql`now()`, stoppedAt: null },
        });
      lastOk = Date.now();
      clearInterval(holder.zettaInstanceTimer);
      holder.zettaInstanceTimer = setInterval(() => void beat(), heartbeatMs);
      current = instance;
      holder.zettaInstance = instance;
    },
    async stop() {
      clearInterval(holder.zettaInstanceTimer);
      await db
        .update(serverInstance)
        .set({ stoppedAt: sql`now()` })
        .where(eq(serverInstance.id, id))
        .catch(() => {});
      if (current === instance) current = undefined;
    },
    async recoveryScope(boot) {
      if (!boot) return { unowned: false };
      const peers = await db
        .select({ id: serverInstance.id })
        .from(serverInstance)
        .where(
          and(
            ne(serverInstance.id, id),
            inArray(serverInstance.role, ["all", "worker"]),
            sql`${serverInstance.stoppedAt} is null`,
            sql`${serverInstance.heartbeatAt} > now() - make_interval(secs => ${deadAfterSeconds})`,
          ),
        )
        .limit(1);
      return { unowned: peers.length === 0 };
    },
  };
  return instance;
}

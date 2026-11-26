import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool, type PoolClient, type PoolConfig } from "pg";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";
import { tenant } from "./tenant";

/** What a connection's `app.workspace_id` was last set to, so a checkout for the same workspace costs no extra round trip. */
const SET = Symbol("workspace setting");
/** The connection already runs as the app's role. */
const ROLE = Symbol("app role");
type Tuned = PoolClient & { [SET]?: string; [ROLE]?: true };

/**
 * The role every query of the app runs as. It is held by the rules between workspaces (migration `workspace_wall_rules`), also where the
 * login is a superuser, which no rule holds.
 */
export const APP_ROLE = "zetta_app";

/**
 * `on`: every connection runs as the app's role, held by the wall between workspaces. `off`: as the login itself, for an operator script
 * that works across workspaces (rotating every person's key). A database with no such role yet (one migrated only so far) runs as the
 * login either way.
 */
export type Wall = "on" | "off";

/**
 * Where work with no workspace runs. On a server of one's own (`ZETTA_MODE` unset or `local`) that is the first workspace, so a start-up
 * step, a test or a path not yet given a workspace keeps working as it did with one workspace. With `ZETTA_MODE=app` it is nowhere: such
 * a query sees no workspace's rows and can write none.
 */
type Fallback = { mode: "first"; id?: string } | { mode: "none" };

/**
 * The pool of the app. Every connection it hands out is set to the workspace of the work that asked for it (tenant.ts) before its first
 * query, whether a single query (`pool.query` checks out through `connect` with a callback) or a transaction (`connect()` as a promise).
 */
class TenantPool extends Pool {
  private readonly fallback: Fallback;
  private role: "switch" | "missing" | "off";

  constructor(config: PoolConfig, fallback: Fallback, wall: Wall) {
    super(config);
    this.fallback = fallback;
    this.role = wall === "on" ? "switch" : "off";
  }

  override connect(): Promise<PoolClient>;
  override connect(
    callback: (
      error: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): void;
  override connect(
    callback?: (
      error: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): Promise<PoolClient> | void {
    const wanted = tenant.setting();
    if (!callback)
      return super.connect().then(async (client) => {
        try {
          return await this.tune(client, wanted);
        } catch (error) {
          client.release(error as Error);
          throw error;
        }
      });
    super.connect((error, client, done) => {
      if (error || !client) return callback(error, client, done);
      this.tune(client, wanted).then(
        () => callback(undefined, client, done),
        (failure: Error) => {
          done(failure);
          callback(failure, undefined, () => {});
        },
      );
    });
  }

  private async tune(client: Tuned, wanted: string | undefined) {
    if (this.role === "switch" && !client[ROLE]) {
      try {
        await client.query(`set role ${APP_ROLE}`);
        client[ROLE] = true;
      } catch (error) {
        // 22023: the role does not exist in this database yet.
        if ((error as { code?: string }).code !== "22023") throw error;
        this.role = "missing";
      }
    }
    const value = wanted ?? (await this.fallbackOf(client));
    if (client[SET] !== value) {
      await client.query("select set_config('app.workspace_id', $1, false)", [value]);
      client[SET] = value;
    }
    return client;
  }

  private async fallbackOf(client: PoolClient) {
    if (this.fallback.mode === "none") return "";
    if (this.fallback.id) return this.fallback.id;
    try {
      const found = await client.query<{ id: string }>(
        "select id from zetta.workspace order by created_at, id limit 1",
      );
      const id = found.rows[0]?.id;
      // Kept once found: the first workspace stays the first.
      if (id) this.fallback.id = id;
      return id ?? "";
    } catch {
      // A database migrated only up to the tables before workspaces.
      return "";
    }
  }
}

export function createDb(env: DatabaseConfig, options: { wall?: Wall } = {}) {
  const pool = new TenantPool(
    {
      connectionString: env.DATABASE_URL,
      // Raw SQL in the server names app tables without a schema; every pooled connection resolves them in `zetta`.
      options: "-c search_path=zetta",
      max: Number(process.env.ZETTA_DB_POOL_MAX) || 20,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    },
    process.env.ZETTA_MODE === "app" ? { mode: "none" } : { mode: "first" },
    options.wall ?? "on",
  );
  // An error on an idle client (server restart, network drop) would otherwise be an unhandled 'error' event and crash the process.
  pool.on("error", (error) => console.error("[db] idle client error:", error.message));
  return drizzle({ client: pool, relations });
}

export type Database = ReturnType<typeof createDb>;
/** The handle a `db.transaction(...)` callback receives. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A single connection outside the pool, for `LISTEN` (a pooled connection goes back to other callers). */
export { Client as PgClient };
export { asWorkspace, SCAN_ALL, tenant } from "./tenant";

/** Who the app's queries run as, for the start-up check: a superuser or a role that skips row rules has no wall. */
export async function databaseRole(db: Database) {
  const found = await db.execute<{ role: string; superuser: boolean; bypass: boolean }>(
    // `current_user`: the role after the pool's switch, not the login.
    "select current_user as role, r.rolsuper as superuser, r.rolbypassrls as bypass from pg_roles r where r.rolname = current_user",
  );
  return found.rows[0]!;
}

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PoolConfig } from "pg";
import { createAdminOperatorClientOwner } from "./admin-operator-client-owner";
import { relations } from "./relations";

export type AdminOperatorTarget = Readonly<{ host: string; port: number; database: string; user: string; password: string }>;

/** No connectionString: every driver default affecting target/session is explicit. */
export function adminOperatorPoolOptions(target: AdminOperatorTarget): PoolConfig {
  return {
    host: target.host, port: target.port, database: target.database, user: target.user, password: target.password,
    ssl: false, sslnegotiation: "postgres", client_encoding: "UTF8",
    options: "-c search_path=public", application_name: "zetta-identity-admin",
    connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000,
    lock_timeout: 2000, idle_in_transaction_session_timeout: 5000,
    max: 1, idleTimeoutMillis: 1000, allowExitOnIdle: true,
    keepAlive: true, keepAliveInitialDelayMillis: 1000,
  };
}

/** Only the guarded CLI opens this owned client; never schema setup or auth startup. */
export async function openAdminOperatorClient(target: AdminOperatorTarget) {
  const pool = new Pool(adminOperatorPoolOptions(target));
  const { reserve, close, healthy } = createAdminOperatorClientOwner(pool);
  try {
    // One reserved backend; the pool cannot silently replace a verified session.
    const client = await pool.connect();
    reserve(client);
    const checked = await client.query<{ matches: boolean }>(
      "select current_database() = $1 and current_user = $2 and session_user = $2 as matches",
      [target.database, target.user],
    );
    if (checked.rows.length !== 1 || checked.rows[0]?.matches !== true) throw new Error("Admin operator client unavailable.");
    healthy();
    const db = drizzle({ client, relations, logger: false });
    return { db, close, healthy };
  } catch {
    try { await close(); } catch { /* The executable hard deadline also bounds cleanup. */ }
    throw new Error("Admin operator client unavailable.");
  }
}

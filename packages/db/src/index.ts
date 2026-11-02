import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    // Raw SQL in the server names app tables without a schema; every pooled connection resolves them in `zetta`.
    options: "-c search_path=zetta",
    max: Number(process.env.ZETTA_DB_POOL_MAX) || 20,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  // An error on an idle client (server restart, network drop) would otherwise be an unhandled 'error' event and crash the process.
  pool.on("error", (error) => console.error("[db] idle client error:", error.message));
  return drizzle({ client: pool, relations });
}

export type Database = ReturnType<typeof createDb>;

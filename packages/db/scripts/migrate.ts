// Applies pending migrations to an external Postgres. The embedded database migrates itself when the server starts; a Postgres of your
// own does not, so a deploy runs this first (packages/infra). Some migrations move extensions between schemas, which only a superuser
// may do: run it as the database's owner while that role is a superuser, from one place at a time.
//   DATABASE_URL=… bun packages/db/scripts/migrate.ts [--pending]     (--pending only prints how many are waiting)
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { join } from "node:path";
import { Pool } from "pg";

import { appliedMigrations, migrationNames, pendingMigrations } from "../src/embedded/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL: this script never touches the embedded database.");
  process.exit(2);
}

const folder = join(import.meta.dir, "../src/migrations");
// One connection and no `search_path` option, as the embedded database does at boot: the first migrations create their tables in
// `public`, and a later one moves everything to `zetta`.
const pool = new Pool({ connectionString: url, max: 1 });

try {
  const pending = pendingMigrations(migrationNames(folder), await appliedMigrations(pool));
  if (process.argv.includes("--pending")) console.log(pending.length);
  else if (pending.length) {
    const failure = await migrate(drizzle({ client: pool }), { migrationsFolder: folder });
    if (failure) throw new Error(`The migrator refused to run: ${JSON.stringify(failure)}`);
    console.log(`    ${pending.length} migrations applied, up to ${pending.at(-1)}`);
  }
} finally {
  await pool.end();
}

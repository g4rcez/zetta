// Applies pending migrations to the embedded database at boot. A database that already holds data is copied first, so a migration that
// goes wrong can never be the only copy.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

import type { EmbeddedLayout } from "./paths";
import type { EmbeddedServer } from "./supervisor";

const KEEP_BACKUPS = 3;
const BACKUP_PREFIX = "postgres-";

/** Migration folder names (`<timestamp>_<name>`) that hold a `migration.sql`, oldest first. */
export function migrationNames(folder: string) {
  return readdirSync(folder)
    .filter((name) => existsSync(join(folder, name, "migration.sql")))
    .sort((a, b) => a.localeCompare(b));
}

export const pendingMigrations = (all: string[], applied: Iterable<string>) => {
  const done = new Set(applied);
  return all.filter((name) => !done.has(name));
};

/**
 * A compiled binary carries the migrations as one JSON file (`[{ name, sql }]`); the migrator reads folders, so they are written out
 * once per bundle. A folder path is returned as is.
 */
export async function materializeMigrations(source: string, layout: EmbeddedLayout) {
  if (!source.endsWith(".json")) return source;
  const file = Bun.file(source);
  const text = await file.text();
  const target = join(layout.migrations, Bun.hash(text).toString(16));
  if (existsSync(join(target, ".complete"))) return target;
  rmSync(target, { recursive: true, force: true });
  for (const { name, sql } of JSON.parse(text) as { name: string; sql: string }[]) {
    mkdirSync(join(target, name), { recursive: true });
    writeFileSync(join(target, name, "migration.sql"), sql);
  }
  writeFileSync(join(target, ".complete"), "");
  return target;
}

async function appliedMigrations(pool: Pool) {
  try {
    const result = await pool.query("select name from drizzle.__drizzle_migrations");
    return result.rows.map((row) => String(row.name));
  } catch (error) {
    // 3F000: no `drizzle` schema, 42P01: no table. Both mean a database nothing was ever applied to.
    const code = (error as { code?: string }).code;
    if (code === "3F000" || code === "42P01") return [];
    throw error;
  }
}

export function pruneBackups(folder: string, keep = KEEP_BACKUPS) {
  const old = readdirSync(folder)
    .filter((name) => name.startsWith(BACKUP_PREFIX))
    .sort((a, b) => b.localeCompare(a))
    .slice(keep);
  for (const name of old) rmSync(join(folder, name), { recursive: true, force: true });
  return old;
}

const stamp = (date: Date) => date.toISOString().replaceAll(/[-:]/g, "").slice(0, 15);

export type MigrationReport = { applied: string[]; backup?: string };

export async function migrateEmbedded(
  server: EmbeddedServer,
  layout: EmbeddedLayout,
  folder: string,
  now: () => Date = () => new Date(),
): Promise<MigrationReport> {
  const all = migrationNames(folder);
  // No `search_path` here: the first migrations create their tables in `public`, and a later one moves everything to `zetta`.
  const connect = () => new Pool({ connectionString: server.url, max: 1 });
  let pool = connect();
  try {
    const applied = await appliedMigrations(pool);
    const pending = pendingMigrations(all, applied);
    if (!pending.length) return { applied: [] };

    let backup: string | undefined;
    if (applied.length) {
      await pool.end();
      backup = join(layout.backups, `${BACKUP_PREFIX}${stamp(now())}-before-${pending[0]}`);
      mkdirSync(layout.backups, { recursive: true });
      const target = backup;
      // A copy of a stopped data folder is a complete, consistent backup: start Postgres on it to read it.
      await server.whileStopped(() => cpSync(layout.data, target, { recursive: true }));
      pruneBackups(layout.backups);
      pool = connect();
    }
    await migrate(drizzle({ client: pool }), { migrationsFolder: folder });
    return { applied: pending, backup };
  } finally {
    await pool.end().catch(() => {});
  }
}

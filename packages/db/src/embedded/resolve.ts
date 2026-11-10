// Picks the database for this process: the Postgres named by DATABASE_URL, or the one that ships inside Zetta when it is empty.
import { migrateEmbedded, materializeMigrations } from "./migrate";
import { checkoutArchive, checkoutMigrations, embeddedLayout, zettaHome } from "./paths";
import { ensureRuntime } from "./runtime";
import { type Lifetime, startEmbedded } from "./supervisor";

export type DatabaseMode = "external" | "embedded";
export type ResolvedDatabase = { mode: DatabaseMode; url: string; stop(): void };

/** Where the runtime archive and the migrations come from. A compiled binary sets `globalThis.zettaEmbeddedSources` to its embedded files. */
export type EmbeddedSources = { archive: string; migrations: string };

const sources = (): EmbeddedSources =>
  (globalThis as { zettaEmbeddedSources?: EmbeddedSources }).zettaEmbeddedSources ?? {
    archive: checkoutArchive(),
    migrations: checkoutMigrations(),
  };

export async function startEmbeddedDatabase(
  home = zettaHome(),
  from = sources(),
  lifetime: Lifetime = "process",
): Promise<ResolvedDatabase> {
  const layout = embeddedLayout(home);
  const runtime = await ensureRuntime(layout, from.archive);
  const server = await startEmbedded(runtime, layout, lifetime);
  const report = await migrateEmbedded(
    server,
    layout,
    await materializeMigrations(from.migrations, layout),
  );
  console.log(
    `[db] embedded Postgres ${server.start} in ${layout.root}` +
      (report.applied.length ? `, ${report.applied.length} migration(s) applied` : "") +
      (report.backup ? `, backup at ${report.backup}` : ""),
  );
  return { mode: "embedded", url: server.url, stop: () => server.stop() };
}

export async function resolveDatabase(env: { DATABASE_URL?: string }): Promise<ResolvedDatabase> {
  const url = env.DATABASE_URL?.trim();
  if (url) return { mode: "external", url, stop() {} };
  return startEmbeddedDatabase();
}

// Where the embedded Postgres lives on disk, and which runtime build it expects.
import { homedir } from "node:os";
import { join } from "node:path";

export const PG_VERSION = "18.6";
export const PGVECTOR_VERSION = "0.8.7";
/** Names the unpacked runtime folder and the archive: a new Postgres or pgvector version unpacks beside the old one. */
export const RUNTIME_VERSION = `${PG_VERSION}-${PGVECTOR_VERSION}`;

export const runtimePlatform = (platform: string = process.platform, arch: string = process.arch) =>
  `${platform}-${arch}`;

export const archiveName = (platform = runtimePlatform()) =>
  `pg-runtime-${RUNTIME_VERSION}-${platform}.tar.zst`;

/** Zetta's local state folder: `ZETTA_HOME`, or `~/.zetta` (where code, artifacts and attachments already live). */
export const zettaHome = (env: Record<string, string | undefined> = process.env) =>
  env.ZETTA_HOME?.trim() || join(homedir(), ".zetta");

export type EmbeddedLayout = ReturnType<typeof embeddedLayout>;

export function embeddedLayout(home: string) {
  const root = join(home, "postgres");
  return {
    root,
    runtime: join(root, "runtime", RUNTIME_VERSION),
    data: join(root, "data"),
    socket: join(root, "run"),
    log: join(root, "postgres.log"),
    password: join(root, "password"),
    detached: join(root, "detached"),
    migrations: join(root, "migrations"),
    backups: join(home, "backups"),
  };
}

/** Where a checkout keeps the runtime archive built by `scripts/pg-runtime.ts` (git-ignored). */
export const checkoutArchive = () => join(import.meta.dir, "../../.pg-runtime", archiveName());

/** The migrations folder in a checkout. */
export const checkoutMigrations = () => join(import.meta.dir, "../migrations");

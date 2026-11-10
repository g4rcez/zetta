# Embedded Postgres for local installs

Status: built 2026-11-10 for macOS and Linux. Windows has no runtime archive yet. The compiled server binary carries the database but does not start yet for an unrelated reason (see "Not done").

## Decision

When `DATABASE_URL` is empty, the server runs the Postgres that ships with Zetta: Postgres 18 with `unaccent` and pgvector, unpacked into `ZETTA_HOME` (default `~/.zetta`), started with the server and migrated at boot. Nothing is installed on the computer: no Docker, no Podman, no Postgres package. With `DATABASE_URL` set, nothing changes.

Postgres stays the only dialect. Local, CI and production run the same queries, schema and migrations.

## Why not SQLite

The request that started this was "SQLite when local". A SQLite mode needs a second schema, a second migration history and a second copy of every Postgres-flavoured query, kept in step for good. At the time of the decision that meant 106 tables, 121 migrations, 201 raw `sql` uses in 34 production files, 24 array columns, 52 `jsonb` columns, full-text search on `tsvector` + GIN + `unaccent` fused with a pgvector HNSW index, advisory locks, `FOR UPDATE SKIP LOCKED` queues, two plpgsql triggers and the Better Auth `pg` adapter. Local would also stop behaving like production.

SQLite would save about 19 MB of download on macOS. That is the whole benefit.

## Why not PGlite (Postgres as WASM)

It keeps the dialect and has both extensions, but it is a single connection: a transaction holds the whole database. Any transaction that awaits a query on the outer `db` would hang, and advisory locks and `SKIP LOCKED` stop meaning anything. `credential-vaults.md` already records WASM as fragile in a compiled server.

## How it works

Code: `packages/db/src/embedded/`.

- **Runtime archive.** `packages/db/scripts/pg-runtime.ts` (`bun run db:runtime`) builds `pg-runtime-<postgres>-<pgvector>-<platform>.tar.zst` into `packages/db/.pg-runtime/` (git-ignored). Postgres binaries come from the `@embedded-postgres/<platform>` npm packages (https://github.com/leinelissen/embedded-postgres); pgvector is compiled against the headers of the same Postgres version. Every download is pinned by checksum. The script then starts the archive and checks `vector`, `unaccent` and `uuidv7()`. `.github/workflows/pg-runtime.yml` builds the four macOS and Linux archives and attaches them to a release on a `pg-runtime-v*` tag.
- **Start.** `resolveDatabase` (`resolve.ts`) is called once in `apps/server/src/services.ts`. It unpacks the runtime if this version is not there, runs `initdb` on first start (UTF8, builtin `C.UTF-8` locale, UTC), and starts Postgres with `pg_ctl`.
- **Reach.** A unix socket private to the OS user, with no network listener. Where there are no unix sockets, or the folder path is too long for one, it listens on loopback on a free port with a generated password (`<home>/postgres/password`).
- **Adopt.** If Postgres is already running on that data folder (a `bun --hot` reload, or a server that was killed), the server uses it instead of starting another.
- **Stop.** The server stops Postgres when it exits on SIGINT or SIGTERM. `bun run db:embedded start` starts it detached: it then keeps running until `bun run db:embedded stop`, for `db:studio` and other tools.
- **Migrate.** Pending migrations are applied at boot with the Drizzle migrator, into the same `drizzle.__drizzle_migrations` table that `drizzle-kit migrate` uses. If the database already holds applied migrations, Postgres is stopped, the data folder is copied to `<home>/backups/postgres-<time>-before-<migration>`, and Postgres is started again before anything is applied. The last three copies are kept. To restore one, stop Zetta and put the copy back as `<home>/postgres/data`.
- **Compiled binary.** `bun run compile` in `apps/server` embeds the archive for the target platform and all migrations as one JSON file.

## Limits

- One Zetta process per embedded database. `api` + `worker` on separate machines need a real `DATABASE_URL`.
- Each backup is a full copy of the data folder, so it costs as much disk as the database.
- Linux archives are built on Ubuntu 22.04; older glibc may not load pgvector.

## Sizes (measured 2026-11-10)

|                                                 | macOS arm64 | Linux arm64  |
| ----------------------------------------------- | ----------- | ------------ |
| Runtime archive                                 | 18.9 MB     | 15.6 MB      |
| Compiled server with the archive and migrations | 93.9 MB     | not built    |
| Compiled server without them                    | 74.5 MB     | not built    |
| Unpacked runtime on disk                        | 76 MB       | not measured |
| Data folder after all migrations                | 72 MB       | not measured |

First start from an empty folder (unpack, `initdb`, 121 migrations) took 12 seconds on macOS arm64.

## Verified

- `bun test src/embedded` in `packages/db`: start, migrate, adopt, backup before a new migration, detached lifetime.
- The whole `apps/server` suite on the embedded database (`ZETTA_TEST_DB=embedded bun test`): 3001 pass, 0 fail, 82 skipped.
- The server from a checkout with an empty `DATABASE_URL`: boot, first account, `kill -9` and adopt, LISTEN/NOTIFY, stop on SIGTERM.
- A compiled binary holding only the database code, run from an empty folder.
- The Linux arm64 archive, built and started in a container.

## Not done

- **Windows.** No archive: pgvector needs an MSVC build. The loopback transport written for it has only run on macOS (when the folder path is too long for a socket).
- **macOS x64 and Linux x64 archives** are in the workflow but have not been built yet.
- **The compiled server does not start**: `onnxruntime-node` (used by Laya) fails to load inside `bun build --compile`. It also does not serve the web UI, and it needs its secrets in the environment.
- `install.sh` and `docker-compose.yml` still use the Postgres container.

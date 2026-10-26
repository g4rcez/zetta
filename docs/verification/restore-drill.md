# Backup/restore drill (RFC-065)

Run 2026-10-23 against the local compose Postgres (disposable development data, not production tooling):

1. `pg_dump -Fc` of database `zetta` (9 users, 28 bots, 68 messages, memories, memberships, all migrations).
2. `create database zetta_restore`, `pg_restore --no-owner` into it: **row counts identical** (users/bots/messages/memories/routines/memberships).
3. `drizzle-kit migrate` on the restored copy: **no-op success** (the migration journal was restored with the data).
4. Server started against `zetta_restore` (`DATABASE_URL` override): `/` answered `OK`, `/api/identity/status` answered `anonymous`, boot recovery ran (no message left `running`), the chief bot with its harness configuration was present.

Not covered: restoring on a different host/version, point-in-time recovery, restoring `ZETTA_CONNECTION_KEY` (without it connections stay disabled), and signing in to the restored copy (needs the same `BETTER_AUTH_SECRET`). Procedure for operators: `docs/operations/recovery.md`.

## Rerun 2026-10-23 (scripted)

`scripts/restore-drill.sh` now repeats the drill: dump, restore into `zetta_restore`, compare row counts (users=9 bots=28 messages=68 memories=1 conversations=32 sources=0, 16 migrations, identical), migrate (no-op), boot the server on the copy (`/` OK, identity `anonymous`, 0 running messages, memory `target` column preserved). Passed.

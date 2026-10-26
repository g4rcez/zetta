#!/usr/bin/env bash
# Backup/restore drill against the compose Postgres (container zetta-postgres). Disposable copy only: never touches the source data.
# Usage: scripts/restore-drill.sh   (needs docker, bun; env DOCKER_BIN to override the docker CLI)
set -euo pipefail
D="${DOCKER_BIN:-docker}"; C="${PG_CONTAINER:-zetta-postgres}"; SRC="${SRC_DB:-zetta}"; DST="${DST_DB:-zetta_restore}"; PW="${POSTGRES_PASSWORD:-password}"
psql() { $D exec -i "$C" psql -U postgres -v ON_ERROR_STOP=1 -At "$@"; }
counts() { psql -d "$1" -c "select 'users='||(select count(*) from \"user\")||' bots='||(select count(*) from bot)||' messages='||(select count(*) from message)||' memories='||(select count(*) from memory)||' conversations='||(select count(*) from conversation)||' sources='||(select count(*) from source)||' migrations='||(select count(*) from drizzle.__drizzle_migrations)"; }
echo "== 1. dump $SRC"; $D exec "$C" pg_dump -U postgres -Fc "$SRC" > /tmp/zetta-drill.dump
echo "== 2. restore into $DST"; psql -d postgres -c "drop database if exists $DST" -c "create database $DST" >/dev/null
$D exec -i "$C" pg_restore -U postgres --no-owner -d "$DST" < /tmp/zetta-drill.dump
A=$(counts "$SRC"); B=$(counts "$DST"); echo "source:   $A"; echo "restored: $B"
[ "$A" = "$B" ] || { echo "ROW COUNTS DIFFER"; exit 1; }
echo "== 3. migrate is a no-op on the restored copy"
(cd packages/db && DATABASE_URL="postgresql://postgres:$PW@127.0.0.1:5432/$DST" bunx drizzle-kit migrate 2>&1 | tail -1)
B2=$(counts "$DST"); [ "$B" = "$B2" ] || { echo "MIGRATE CHANGED DATA"; exit 1; }
echo "== 4. server boots on the restored copy"
(cd apps/server && PORT=3917 DATABASE_URL="postgresql://postgres:$PW@127.0.0.1:5432/$DST" bun src/index.ts >/tmp/zetta-drill.log 2>&1 & echo $! > /tmp/zetta-drill.pid)
for i in $(seq 1 30); do curl -fs http://127.0.0.1:3917/ >/dev/null 2>&1 && break; sleep 1; done
echo "GET /: $(curl -s http://127.0.0.1:3917/)"; echo "identity: $(curl -s http://127.0.0.1:3917/api/identity/status)"
kill "$(cat /tmp/zetta-drill.pid)" 2>/dev/null || true
echo "running messages after boot: $(psql -d "$DST" -c "select count(*) from message where status='running'")"
echo "memory targets: $(psql -d "$DST" -c "select target||'='||count(*) from memory group by target order by 1" | tr '\n' ' ')"
echo "== done: drill passed"

#!/usr/bin/env bash
# bun run zetta (everything runs through Vite+ `vp`): start postgres, apply migrations, then run backend + frontend for local testing.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=""
for runtime in docker podman; do
  if command -v "$runtime" >/dev/null 2>&1 && "$runtime" info >/dev/null 2>&1; then CONTAINER=$runtime; break; fi
done
[ -n "$CONTAINER" ] || { echo "a running docker or podman is required to run postgres" >&2; exit 1; }

echo "▶ Starting postgres"
$CONTAINER compose up -d postgres

echo "▶ Waiting for postgres"
for _ in $(seq 1 60); do
  $CONTAINER exec zetta-postgres pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
$CONTAINER exec zetta-postgres pg_isready -U postgres >/dev/null || { echo "postgres did not become ready" >&2; exit 1; }

echo "▶ Applying migrations"
(cd packages/db && vp exec varlock run -- vp exec drizzle-kit migrate)

echo "▶ Starting server (BETTER_AUTH_URL in apps/server/.env) and web (see vite output)"
pids=()
cleanup() { trap - INT TERM EXIT; kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

vp run --filter server dev:server & pids+=($!)
vp run --filter web dev & pids+=($!)

# Portable stand-in for `wait -n` (macOS ships bash 3.2): exit when either process ends; the EXIT trap stops the other.
while :; do
  for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null || exit 0; done
  sleep 1
done

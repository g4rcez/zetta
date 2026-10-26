#!/usr/bin/env bash
# pnpm zetta: start postgres, apply migrations, then run backend + frontend for local testing.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v docker >/dev/null 2>&1; then CONTAINER=docker; elif command -v podman >/dev/null 2>&1; then CONTAINER=podman; else
  echo "docker or podman is required to run postgres" >&2; exit 1
fi

echo "▶ Starting postgres"
$CONTAINER compose up -d postgres

echo "▶ Waiting for postgres"
for _ in $(seq 1 60); do
  $CONTAINER exec zetta-postgres pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
$CONTAINER exec zetta-postgres pg_isready -U postgres >/dev/null || { echo "postgres did not become ready" >&2; exit 1; }

echo "▶ Applying migrations"
(cd packages/db && bun x varlock run -- bun x drizzle-kit migrate)

echo "▶ Starting server (http://localhost:3000) and web (see vite output)"
pids=()
cleanup() { trap - INT TERM EXIT; kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

(cd apps/server && exec bun x varlock run -- bun run --hot src/index.ts) & pids+=($!)
(cd apps/web && exec bun x varlock run -- bun x vp dev) & pids+=($!)

wait -n

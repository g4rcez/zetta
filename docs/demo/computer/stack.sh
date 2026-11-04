#!/usr/bin/env bash
# The isolated Zetta stack the computer demos are recorded on: its own database, API server and web dev server, with fake data only.
#
#   docs/demo/computer/stack.sh up     # fresh database, server, web app, seed (a bot named Operator that can use computers)
#   docs/demo/computer/stack.sh down   # stop them and remove the computers the demo made
#
# It shares nothing with a Zetta you run for yourself: other ports (web 3056, API 3077, database 55434), its own state folder, its own
# environment (nothing is read from apps/*/.env), and a container CLI wrapper (bin/docker) that keeps the server's sweep away from your
# computers. It needs a container engine (Podman or Docker) and the desktop images (docker/desktop, see docs/operations/runtime-modes.md).
#
# Variables: ZETTA_DEMO_DIR (state, default $TMPDIR/zetta-demo-computer), ZETTA_DEMO_ENGINE (podman or docker), ZETTA_VM_IMAGE,
# ZETTA_VM_IMAGE_UBUNTU, ZETTA_DEMO_WEB_PORT, ZETTA_DEMO_API_PORT, ZETTA_DEMO_PG_PORT.
set -euo pipefail

KIT=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$KIT/../../.." && pwd)
DEMO=${ZETTA_DEMO_DIR:-${TMPDIR:-/tmp}/zetta-demo-computer}
DEMO=${DEMO%/}
WEB_PORT=${ZETTA_DEMO_WEB_PORT:-3056}
API_PORT=${ZETTA_DEMO_API_PORT:-3077}
PG_PORT=${ZETTA_DEMO_PG_PORT:-55434}
PG=zetta-demo-pg
ENGINE=${ZETTA_DEMO_ENGINE:-$(command -v podman || command -v docker || true)}
[ -n "$ENGINE" ] || { echo "No container engine: install Podman or Docker, or set ZETTA_DEMO_ENGINE." >&2; exit 1; }
ORIGIN="https://localhost:$WEB_PORT"
DB_URL="postgresql://postgres:password@127.0.0.1:$PG_PORT/zetta_demo"

psql_demo() { "$ENGINE" exec "$PG" psql -U postgres -d zetta_demo -At "$@"; }

# Kills a process we started, but only if it still is ours (a pid file can outlive its process, and pids are reused).
stop_ours() {
  local file=$1 marker=$2 pid
  [ -f "$file" ] || return 0
  pid=$(cat "$file")
  rm -f "$file"
  kill -0 "$pid" 2>/dev/null || return 0
  if ps -o command= -p "$pid" | grep -q -- "$marker" || lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -q "^n$marker"; then
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  fi
}
# vite.demo.config.ts is on the command line of the dev server, so this matches nothing of another Zetta.
stop_web_children() { pkill -f "$KIT/vite.demo.config.ts" 2>/dev/null || true; }

# The computers of the previous run: containers and volumes, named by the ids in the demo database (never by a name pattern).
remove_demo_computers() {
  "$ENGINE" inspect "$PG" >/dev/null 2>&1 || return 0
  local id
  for id in $(psql_demo -c "select id from zetta.computer_vm" 2>/dev/null || true); do
    "$ENGINE" rm -f "zetta-vm-$id" >/dev/null 2>&1 || true
    "$ENGINE" volume rm -f "zetta-vm-$id" >/dev/null 2>&1 || true
  done
}

down() {
  remove_demo_computers
  stop_ours "$DEMO/web.pid" "--port $WEB_PORT"
  stop_web_children
  stop_ours "$DEMO/server.pid" "$DEMO/server"
  "$ENGINE" stop "$PG" >/dev/null 2>&1 || true
  echo "stack is down"
}

wait_for() { # url, label, seconds
  local i
  for i in $(seq 1 "$3"); do
    curl -ks -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "$2 did not answer on $1 in $3 s; see $DEMO/*.log" >&2
  exit 1
}

up() {
  mkdir -p "$DEMO"
  stop_ours "$DEMO/web.pid" "--port $WEB_PORT"
  stop_web_children
  stop_ours "$DEMO/server.pid" "$DEMO/server"

  # Database: one container of its own, one throwaway database in it.
  if "$ENGINE" inspect "$PG" >/dev/null 2>&1; then
    "$ENGINE" start "$PG" >/dev/null 2>&1 || true
  else
    "$ENGINE" run -d --name "$PG" -e POSTGRES_PASSWORD=password -p "127.0.0.1:$PG_PORT:5432" \
      docker.io/pgvector/pgvector:pg18-trixie >/dev/null
  fi
  until "$ENGINE" exec "$PG" pg_isready -q -h 127.0.0.1 -U postgres 2>/dev/null; do sleep 1; done
  remove_demo_computers
  "$ENGINE" exec "$PG" psql -U postgres -q \
    -c "drop database if exists zetta_demo with (force)" -c "create database zetta_demo"
  (cd "$REPO/packages/db" && env -i HOME="$HOME" USER="${USER:-demo}" PATH="$PATH" DATABASE_URL="$DB_URL" \
    bun --no-env-file run db:migrate >"$DEMO/migrate.log" 2>&1) || { echo "migration failed; see $DEMO/migrate.log" >&2; exit 1; }
  echo "database ready"

  # Values made for this run only.
  local setup_key password auth_secret connection_key
  setup_key=$(openssl rand -base64 24)
  password=$(openssl rand -base64 12)
  auth_secret=$(openssl rand -base64 48)
  connection_key=$(openssl rand -base64 32)
  (umask 077 && printf '{"setupKey":"%s","password":"%s"}\n' "$setup_key" "$password" >"$DEMO/secrets.json")

  # API server. It runs from its own folder so that varlock finds no .env there (nothing of a real installation leaks in), and every
  # place it writes to is inside $DEMO. bin/ comes first on PATH so the server finds the stand-in `claude`.
  rm -rf "$DEMO/server" "$DEMO/state"
  mkdir -p "$DEMO/server"
  mkdir -p "$DEMO"/state/{files,vm,browser,artifacts,attachments,code,plugins}
  grep -v generateTsTypes "$REPO/apps/server/.env.schema" >"$DEMO/server/.env.schema"
  (
    cd "$DEMO/server"
    nohup env -i \
      HOME="$HOME" USER="${USER:-demo}" PATH="$KIT/bin:$PATH" \
      NODE_ENV=development PORT="$API_PORT" \
      BETTER_AUTH_SECRET="$auth_secret" BETTER_AUTH_URL="$ORIGIN" CORS_ORIGIN="$ORIGIN" \
      DATABASE_URL="$DB_URL" ZETTA_CONNECTION_KEY="$connection_key" ZETTA_SETUP_KEY="$setup_key" \
      ZETTA_DB_POOL_MAX=10 ZETTA_EMBEDDING=off \
      ZETTA_FILES_ROOT="$DEMO/state/files" ZETTA_VM_TOKEN_ROOT="$DEMO/state/vm" ZETTA_BROWSER_ROOT="$DEMO/state/browser" \
      ZETTA_ARTIFACTS_ROOT="$DEMO/state/artifacts" ZETTA_ATTACHMENTS_ROOT="$DEMO/state/attachments" \
      ZETTA_CODE_ROOT="$DEMO/state/code" ZETTA_CLAUDE_PLUGIN_ROOT="$DEMO/state/plugins" \
      ZETTA_DESKTOP_RUNTIME=docker ZETTA_DOCKER_BIN="$KIT/bin/docker" ZETTA_DEMO_ENGINE="$ENGINE" \
      ZETTA_VM_DRIVERS=cua,agent-desktop ZETTA_VM_OS=debian,ubuntu \
      ZETTA_VM_IMAGE="${ZETTA_VM_IMAGE:-localhost/zetta-desktop:latest}" \
      ZETTA_VM_IMAGE_UBUNTU="${ZETTA_VM_IMAGE_UBUNTU:-localhost/zetta-desktop-ubuntu:latest}" \
      bun --no-env-file run "$REPO/apps/server/src/index.ts" >"$DEMO/server.log" 2>&1 </dev/null &
    echo $! >"$DEMO/server.pid"
  )

  # Web dev server: the app's own config with another port, API target and cache (vite.demo.config.ts).
  (
    cd "$REPO/apps/web"
    nohup env -i \
      HOME="$HOME" USER="${USER:-demo}" PATH="$PATH" NODE_ENV=development \
      VITE_SERVER_URL="$ORIGIN" ZETTA_DEMO_WEB_PORT="$WEB_PORT" ZETTA_DEMO_API_URL="http://127.0.0.1:$API_PORT" \
      ZETTA_DEMO_VITE_CACHE="$DEMO/vite-cache" \
      bun run vp dev --config "$KIT/vite.demo.config.ts" --port "$WEB_PORT" --strictPort >"$DEMO/web.log" 2>&1 </dev/null &
    echo $! >"$DEMO/web.pid"
  )

  wait_for "http://127.0.0.1:$API_PORT/" "the API server" 90
  wait_for "$ORIGIN/" "the web app" 90
  echo "server and web app ready: $ORIGIN"
  bun "$KIT/seed.ts"
}

case "${1:-}" in
up) up ;;
down) down ;;
*) echo "usage: stack.sh up|down" >&2; exit 2 ;;
esac

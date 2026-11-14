#!/usr/bin/env bash
# bun run dev:portless: backend + web behind portless (https://portless.sh), served at https://zetta.local with a locally trusted certificate.
# portless owns HTTPS and the host name; the web dev server (plain HTTP) forwards /api to the API on http://127.0.0.1:6000, so the browser makes no
# cross-origin call. Better Auth only accepts the origin in ZETTA_SERVER_URL, hence one address everywhere.
# First run: portless asks for sudo once (port 443, the /etc/hosts line for zetta.local, trusting its CA). Needs Node.js 24+ and `npm i -g portless`.
# Postgres is not started here: leave DATABASE_URL empty for the embedded one, or `bun run db:start`.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v portless >/dev/null 2>&1 || { echo "portless is required: npm install -g portless" >&2; exit 1; }

# ZETTA_SERVER_URL (default https://zetta.local) is the one public address. Its first label is the portless app name and the rest is the proxy's
# TLD: https://zetta.dev.example.com runs as app `zetta` on TLD `dev.example.com`. A proxy already running with another TLD must be stopped first:
# portless proxy stop. Google refuses .local for a Web application OAuth client: use a Desktop app client (plugin setting Client type).
URL=${ZETTA_SERVER_URL:-https://zetta.local}
HOST=${URL#*://}; HOST=${HOST%%[:/]*}
export PORTLESS_TLD=${HOST#*.}

# Process variables win over the .env files (varlock and Vite), so a stale .env cannot point the pair at different addresses.
export PORT=6000 ZETTA_SERVER_URL=$URL
# Bun reads this only at process start: the server may call its own public address, signed by the portless CA.
export NODE_EXTRA_CA_CERTS="${PORTLESS_STATE_DIR:-$HOME/.portless}/ca.pem"

echo "▶ Web $URL (proxies /api to the API on http://127.0.0.1:6000)"
pids=()
cleanup() { trap - INT TERM EXIT; kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

ZETTA_HOST=127.0.0.1 vp run --filter server dev:server & pids+=($!)
# `portless run` names the app after the first label of the address and injects the port; it does not pass PORT=6000 on to the web server.
(cd apps/web && env -u PORT portless run --name "${HOST%%.*}" vp dev) & pids+=($!)

# Portable stand-in for `wait -n` (macOS ships bash 3.2): exit when either process ends; the EXIT trap stops the other.
while :; do
  for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null || exit 0; done
  sleep 1
done

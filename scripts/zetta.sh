#!/usr/bin/env bash
# bun run zetta (everything runs through Vite+ `vp`): start postgres, apply migrations, then run backend + frontend, open to the local network.
# The web dev server is the only HTTPS entry point (https://<address>:3000, certificate from mkcert, see scripts/dev-certs.sh). It forwards /api to
# the API on http://127.0.0.1:6000 (apps/web/vite.config.ts), so the browser makes no cross-origin call and the API never listens on the network.
# <address> is this machine's private IPv4 address; set ZETTA_ADDRESS=<ip-or-host> to choose another. Open that address on every device, this one too:
# Better Auth only accepts the origin in BETTER_AUTH_URL.
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

ADDRESS=${ZETTA_ADDRESS:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')}
[ -n "$ADDRESS" ] || { echo "no network address found: set ZETTA_ADDRESS=<ip-or-host>" >&2; exit 1; }

# The certificate must name the address, or other devices reject it. dev-certs.sh needs mkcert and keeps the same local CA.
if ! openssl x509 -in .certs/localhost.pem -noout -text 2>/dev/null | grep -qE "(IP Address|DNS):$ADDRESS($|,)"; then
  echo "▶ Creating a certificate for $ADDRESS"
  bash scripts/dev-certs.sh "$ADDRESS" >/dev/null
fi

# Process variables win over .env files (varlock and Vite), so nothing is written to .env.
export PORT=6000 BETTER_AUTH_URL=https://$ADDRESS:3000 CORS_ORIGIN=https://$ADDRESS:3000 VITE_SERVER_URL=https://$ADDRESS:3000
echo "▶ Web https://$ADDRESS:3000 (proxies /api to the API on http://127.0.0.1:6000)"
echo "  Other devices trust .certs/rootCA.pem once (install it as a root certificate)."

echo "▶ Starting server and web (see vite output)"
pids=()
cleanup() { trap - INT TERM EXIT; kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

# ZETTA_HOST is read by both: the API stays on loopback, only the web dev server listens on the network.
ZETTA_HOST=127.0.0.1 vp run --filter server dev:server & pids+=($!)
ZETTA_HOST=0.0.0.0 ZETTA_TLS_CERT=../../.certs/localhost.pem ZETTA_TLS_KEY=../../.certs/localhost-key.pem vp run --filter web dev & pids+=($!)

# Portable stand-in for `wait -n` (macOS ships bash 3.2): exit when either process ends; the EXIT trap stops the other.
while :; do
  for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null || exit 0; done
  sleep 1
done

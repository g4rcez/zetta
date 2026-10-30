#!/usr/bin/env bash
# bun run certs: create a locally trusted TLS certificate for https://localhost (API on :3000, web on :3001).
# Needs mkcert (https://github.com/FiloSottile/mkcert) with its CA installed once: `mkcert -install`.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v mkcert >/dev/null 2>&1 || { echo "mkcert is required: install it, then run \`mkcert -install\` once" >&2; exit 1; }

mkdir -p .certs
mkcert -cert-file .certs/localhost.pem -key-file .certs/localhost-key.pem localhost 127.0.0.1 ::1
# The public root certificate only (never rootCA-key.pem): Bun does not read the macOS keychain.
cp "$(mkcert -CAROOT)/rootCA.pem" .certs/rootCA.pem

cat <<MSG

Add to apps/server/.env and apps/web/.env (paths are relative to each app):
  ZETTA_TLS_CERT=../../.certs/localhost.pem
  ZETTA_TLS_KEY=../../.certs/localhost-key.pem
and to apps/server/.env only:
  NODE_EXTRA_CA_CERTS=../../.certs/rootCA.pem
Then use https:// in BETTER_AUTH_URL, CORS_ORIGIN (apps/server/.env) and VITE_SERVER_URL (apps/web/.env), and restart `bun dev`.
MSG

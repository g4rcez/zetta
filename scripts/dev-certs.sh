#!/usr/bin/env bash
# bun run certs [extra names]: create a locally trusted TLS certificate for https://localhost (the web dev server on :3000; the API on :6000 stays plain HTTP behind its proxy).
# Extra names (a LAN IP or host name) are added to the certificate; `bun run setup` passes the LAN address.
# Needs mkcert (https://github.com/FiloSottile/mkcert) with its CA installed once: `mkcert -install`.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v mkcert >/dev/null 2>&1 || { echo "mkcert is required: install it, then run \`mkcert -install\` once" >&2; exit 1; }

mkdir -p .certs
mkcert -cert-file .certs/localhost.pem -key-file .certs/localhost-key.pem localhost 127.0.0.1 ::1 "$@"
# The public root certificate only (never rootCA-key.pem): Bun does not read the macOS keychain.
cp "$(mkcert -CAROOT)/rootCA.pem" .certs/rootCA.pem

cat <<MSG

Optional: without these lines the web dev server uses a self-signed certificate that the browser asks you to accept once.
Add to apps/web/.env (paths are relative to apps/web) to use the trusted pair instead:
  ZETTA_TLS_CERT=../../.certs/localhost.pem
  ZETTA_TLS_KEY=../../.certs/localhost-key.pem
Use https://localhost:3000 in BETTER_AUTH_URL and CORS_ORIGIN (apps/server/.env) and in VITE_SERVER_URL (apps/web/.env), then restart `bun dev`.
MSG

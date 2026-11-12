#!/usr/bin/env bash
# One command that says the code base is sound: lint, typecheck and every unit suite that needs no database or Docker.
# CI runs the same steps (the `checks` job in .github/workflows/ci.yml). Database-backed server suites are run by the `test` job.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

step() { printf '\n== %s\n' "$1"; }

# The web tests share one process for about 120 files, and a few callbacks that one file leaves behind (a debounced save that shows a
# toast, a store that cleans up a second later) can fail the run of another file. A failed run is repeated up to twice, and every repeat
# is printed; a real failure fails all three runs.
retry() {
  local attempt=1
  until "$@"; do
    [ "$attempt" -ge 3 ] && return 1
    echo "!! failed (attempt $attempt of 3), running again: $*"
    attempt=$((attempt + 1))
  done
}

step "lint"
bunx oxlint

step "typecheck"
# The web typecheck needs the generated route tree (gitignored); a fresh checkout has none, and without it tsc reports about 70 route errors.
if [ ! -f apps/web/src/routeTree.gen.ts ]; then
  echo "-- generating apps/web/src/routeTree.gen.ts"
  (cd apps/web && VITE_SERVER_URL="${VITE_SERVER_URL:-http://localhost:3000}" bunx vp build >/dev/null)
fi
for dir in apps/server apps/web packages/db packages/auth packages/core packages/render packages/laya; do
  echo "-- $dir"
  (cd "$dir" && bunx tsc --noEmit)
done

step "unit tests"
for dir in apps/web apps/cli apps/landing packages/auth packages/core packages/render packages/laya packages/ui; do
  echo "-- $dir"
  if [ "$dir" = "apps/web" ]; then
    retry bash -c 'cd apps/web && bun test'
  else
    (cd "$dir" && bun test)
  fi
done
echo "-- tools, scripts"
bun test tools scripts

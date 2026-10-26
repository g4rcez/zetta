#!/usr/bin/env bash
set +x
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "$#" -gt 1 ]]; then
  echo 'Identity launcher: expected auth, operator, credentials, credential-operator, identity-lock-order, identity-lock-positive, connection-schema, connection-store, run-schema, run-store, run-restart, run-provenance-diagnostic, dispatch-schema, identity-activation-backfill, identity-activation-exhaustion or browser.' >&2
  exit 1
fi
proof_args=()
case "${1:-auth}" in
  auth) proof=./apps/server/src/modules/identity/signup.integration.ts ;;
  operator) proof=./apps/server/src/modules/identity/admin-operator.integration.ts ;;
  credentials) proof=./apps/server/src/modules/identity/credential-provisioning.integration.ts ;;
  credential-operator) proof=./apps/server/src/modules/identity/credential-operator.integration.ts ;;
  identity-lock-order) proof=./apps/server/src/modules/identity/identity-lock-order.integration.ts ;;
  identity-lock-positive) proof=./apps/server/src/modules/identity/identity-lock-positive.integration.ts ;;
  connection-store) proof=./apps/server/src/modules/connections/store.integration.ts ;;
  connection-schema) proof=./apps/server/src/modules/connections/schema.integration.ts ;;
  run-schema) proof=./apps/server/src/modules/runtime/run-schema.integration.ts ;;
  run-store) proof=./apps/server/src/modules/runtime/runs.integration.ts ;;
  run-restart) proof=./apps/server/src/modules/runtime/runs-restart.integration.ts ;;
  run-provenance-diagnostic) proof=./apps/server/src/modules/runtime/run-provenance-diagnostic.integration.ts ;;
  dispatch-schema) proof=./apps/server/src/modules/runtime/dispatch-schema.integration.ts ;;
  identity-activation-backfill) proof=./apps/server/src/modules/identity/identity-activation.integration.ts; proof_args=(backfill) ;;
  identity-activation-exhaustion) proof=./apps/server/src/modules/identity/identity-activation.integration.ts; proof_args=(exhaustion) ;;
  browser) proof=./apps/server/src/test-support/identity-browser-server.ts ;;
  *) echo 'Identity launcher: expected auth, operator, credentials, credential-operator, identity-lock-order, identity-lock-positive, connection-schema, connection-store, run-schema, run-store, run-restart, run-provenance-diagnostic, dispatch-schema, identity-activation-backfill, identity-activation-exhaustion or browser.' >&2; exit 1 ;;
esac

compose=(docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests)
project_filter=label=com.docker.compose.project=zetta-identity-tests

# Refuse existing resources instead of adopting or deleting another run's state.
for resource in container network volume; do
  flags=(--quiet)
  if [[ "$resource" == container ]]; then flags+=(--all); fi
  existing="$(docker "$resource" ls "${flags[@]}" --filter "$project_filter")"
  if [[ -n "$existing" ]]; then
    echo 'Identity auth launcher: test project already exists; refusing to reuse or delete it.' >&2
    exit 1
  fi
done

export ZETTA_IDENTITY_TEST_PASSWORD="$(bun --no-env-file -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"))')"
export ZETTA_TEST_DATABASE_URL="postgresql://zetta_identity_runner:${ZETTA_IDENTITY_TEST_PASSWORD}@127.0.0.1:55432/zetta_identity_test"
export ZETTA_TEST_DATABASE_ALLOW_MUTATION=identity-tests
export NODE_ENV="${NODE_ENV:-development}"

# Fail before provisioning; keep application DATABASE_URL and all denial selectors.
bun --no-env-file -e '
  import { requireIdentityAuthProofTarget } from "./apps/server/src/modules/identity/signup.integration.ts";
  try { requireIdentityAuthProofTarget(process.env); }
  catch {
    console.error("Identity auth launcher: unsafe environment; check DATABASE_URL, PG*, NODE_PG_FORCE_NATIVE, TEST, NODE_ENV and BETTER_AUTH_TELEMETRY* without printing their values.");
    process.exit(1);
  }
'
"${compose[@]}" config --quiet

cleanup() {
  result=$?
  trap - EXIT INT TERM
  if ! "${compose[@]}" down --timeout 5; then
    echo 'Identity auth launcher: dedicated teardown failed; manual review required.' >&2
    exit 1
  fi
  for resource in container network; do
    flags=(--quiet)
    if [[ "$resource" == container ]]; then flags+=(--all); fi
    if ! remaining="$(docker "$resource" ls "${flags[@]}" --filter "$project_filter")" || [[ -n "$remaining" ]]; then
      echo 'Identity auth launcher: dedicated resources remain; manual review required.' >&2
      exit 1
    fi
  done
  echo 'PASS dedicated Compose container/network cleanup; no volume removal'
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Existing local image only; bounded health wait and tmpfs storage are mandatory.
"${compose[@]}" up -d --pull never --wait --wait-timeout 60 postgres
container_id="$("${compose[@]}" ps -q postgres)"
[[ -n "$container_id" && "$container_id" != *$'\n'* ]]
format='{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"ports":{{json .HostConfig.PortBindings}},"tmpfs":{{json .HostConfig.Tmpfs}},"mounts":{{json .Mounts}},"health":{{json .State.Health.Status}}}'
docker inspect --format "$format" "$container_id" | bun --no-env-file -e '
  const s = await Bun.stdin.json();
  if (s.project !== "zetta-identity-tests" || s.service !== "postgres" || s.health !== "healthy"
    || JSON.stringify(s.ports) !== JSON.stringify({"5432/tcp":[{HostIp:"127.0.0.1",HostPort:"55432"}]})
    || !s.tmpfs || !Object.hasOwn(s.tmpfs, "/var/lib/postgresql")
    || !Array.isArray(s.mounts) || s.mounts.some(m => m.Type !== "tmpfs")) {
    console.error("Identity auth launcher: dedicated container verification failed; safe checks=" + JSON.stringify({
      project: s.project === "zetta-identity-tests", service: s.service === "postgres", health: s.health === "healthy",
      port: JSON.stringify(s.ports) === JSON.stringify({"5432/tcp":[{HostIp:"127.0.0.1",HostPort:"55432"}]}),
      tmpfs: !!s.tmpfs && Object.hasOwn(s.tmpfs, "/var/lib/postgresql"),
      mountCount: Array.isArray(s.mounts) ? s.mounts.length : -1,
      onlyTmpfs: Array.isArray(s.mounts) && s.mounts.every(m => m.Type === "tmpfs")
    }));
    process.exit(1);
  }
  console.log("PASS dedicated Compose ownership, loopback port, tmpfs-only storage and health");
'

# Docker may report --tmpfs only in HostConfig, not Mounts. Check the live filesystem too.
filesystem="$(docker exec --user postgres "$container_id" stat -f -c %T /var/lib/postgresql)"
if [[ "$filesystem" != tmpfs ]]; then
  echo 'Identity auth launcher: PostgreSQL data filesystem is not tmpfs.' >&2
  exit 1
fi
echo 'PASS dedicated PostgreSQL data filesystem is tmpfs'

if [[ "${#proof_args[@]}" -eq 0 ]]; then
  bun --no-env-file "$proof"
else
  bun --no-env-file "$proof" "${proof_args[@]}"
fi

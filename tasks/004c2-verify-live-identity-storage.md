# RFC-004c2: Prepare the first bounded live identity-storage proof

- **Parent:** [004c](004c-verify-identity-database-constraints.md), within root RFC-004.
- **Prerequisite:** accepted [004c1](004c1-guard-disposable-identity-test-target.md), existing identity schema, transactional enrollment and admin-lifecycle services.
- **Status:** accepted bounded live slice after source review, coordinator execution/diagnostics and final independent review. Seven SQL checks and dedicated cleanup passed. Implementation worker did not run live commands. Parent/root remain incomplete.

## Approved boundary and permission

The user explicitly authorized PostgreSQL provisioning using repository Compose, delegating infrastructure/isolation decisions to the coordinator. The coordinator found Compose 5.6.0 and a responsive Linux Docker engine 29.5.2; these are coordinator observations, not worker live evidence. The approved worker task was single-writer **offline source preparation**, not any connection, image pull, container/network creation, migration application or cleanup. The coordinator owns those commands after independent review, using the separate disposable resources below. Existing `postgres:18` database `zetta`, named container and persistent volume must remain untouched.

No installs, manifests/lockfiles, production auth/schema/config behavior, full feature/UI, app endpoints, Better Auth E2E, full suite/build, staging, commits or agents. Preserve unrelated work. Invitation acceptance races and remaining 004c races may follow in 004c3; this source/live slice cannot close parent/root.

## Bounded implementation

- `docker-compose.identity-test.yml`: DB only; `postgres:18`, project `zetta-identity-tests`, dedicated `zetta_identity_runner` / `zetta_identity_test`, caller-required throwaway password, only 127.0.0.1:55432, separate project bridge network, traversable tmpfs parent0755 and privately initialized nested PGDATA, TCP healthcheck, bounded CPU/memory/PIDs/connections/healthcheck/shutdown. No container_name, persistent/bind volume, env file, app secrets or full Compose interpolation.
- `packages/db/drizzle.identity-test.config.ts`: pure offline generator config, exact existing schema `./src/schema/index.ts`, separate `./identity-test-migrations` output, no credentials/varlock/env autoload. Production config/manifest untouched.
- `packages/db/identity-test-migrations/20261022123627_identity_initial/{migration.sql,snapshot.json}`: installed-generator output, not hand-edited. Generation command below.
- `apps/server/src/test-support/identity-proof-target.ts` and `.test.ts`: preserve accepted general guard; add dedicated endpoint/user/nonempty-password restriction and denial of all ambient PG* keys and NODE_PG_FORCE_NATIVE before any runtime import. Missing target/ack fails closed, not a skip. Synthetic tests include a clean no-network denial subprocess.
- `packages/db/src/identity-proof-client.ts`: minimal DB-local test-only driver resolution, three independent max-one-connection pools, explicit driver config/timeouts, identity/marker/owner checks, fixed setup owner/advisory lock, empty-target requirement, exact migration folder/hash and installed Drizzle apply-once runner, fixed eight-table fixture truncation, bounded close/error handling. No arbitrary SQL/migration/target CLI, production client or env loader.
- `apps/server/src/modules/identity/enrollment.integration.ts`: standalone explicit-command-only entry, deliberately not `*.test.ts`. Guard executes before dynamic runtime adapter/service imports and uses only its returned normalized URL. Seven first-slice live checks, all errors suppressed to fixed diagnostics; no driver cause/URL/password/binds printed. Finite 90 s hard deadline including cleanup.
- [Runbook](../docs/verification/identity-database.md): exact offline and coordinator-only setup/apply+test/cleanup commands, credentials handling, target marker limitations and evidence gates.

## Live setup ownership and tests

Before any mutation, every pool must report exact database/user/session user and database owner, PostgreSQL major 18, PGDATA `/var/lib/postgresql/18/docker`, and the service startup setting `zetta.identity_test_marker=zetta-identity-tests-v1`. This is a deliberate dedicated-service marker, **not** cryptographic attestation. Coordinator confirmation of the exact new isolated project is still mandatory; a forged/copied marker cannot prove disposability.

The owner holds a fixed advisory lock and rejects existing user objects/routines/nonstandard schemas/extensions. It applies only the pinned reviewed initial migration once, then keeps the Drizzle bookkeeping journal. A second invocation fails; use dedicated project down/up, not schema drop/reset. Before/after each check the owner rechecks service identity and exact eight public table names and truncates all eight together, without CASCADE. Fault scopes add/drop only the fixed `identity_proof_fail_audit CHECK(false) NOT VALID` constraint; the generated SQL is untouched.

Prepared live checks (not passing SQL evidence yet):

1. Singleton check/PK; valid and invalid membership status/removal; missing/removed active-admin FK; prohibited update/delete of referenced admin membership.
2. Invitation token-hash uniqueness (not speculative hash-format enforcement), strict expiry, paired consumed-at/user, canonical email, valid consumption pair.
3. Audit event/actor kind and actor-null consistency, operator-only nonblank replacement reason, valid operator replacement.
4. Bootstrap committed singleton, active membership and operator audit read from an independent owner connection.
5. Two independent backend PIDs race bootstrap. An owner transaction holds both account rows until both contenders are observed waiting on row locks, proving both have passed the absent singleton read. Release; require one winner/one opaque denial, exactly winner membership/audit, no orphan activation/audit.
6. Real SQL audit failure after bootstrap activation/insertion rolls all state back, then retry succeeds after fault removal.
7. Real SQL replacement audit failure after session deletion restores pointer, exact membership rows and all sessions/audit. Retry commits pointer/reactivation, preserves joined-at, removes both affected users' sessions only and records the trimmed operator reason.

No invitation-service acceptance/concurrency, HTTP/auth/session-cache E2E, issuance-versus-replacement or full identity completion is claimed. These remain parent/future-slice gates.

## Commands actually run by worker (offline only)

1. `cd packages/db && bun --no-env-file ./node_modules/drizzle-kit/bin.cjs generate --config=drizzle.identity-test.config.ts --name=identity_initial` — exit 0. Created the exact SQL/snapshot paths above without a DB target/client/application. Later inspection found installed CLI bundles unconditional dotenv/config, so Bun's flag alone does not suppress library autoload. No `packages/db/.env` or ambient dotenv path/key/debug/override selectors were present when checked (existence/presence only, no contents/values); this is not retrospective IO tracing. Corrected command `cd packages/db && env -i PATH="$PATH" HOME="$HOME" DOTENV_CONFIG_PATH=/dev/null bun --no-env-file ./node_modules/drizzle-kit/bin.cjs generate --config=drizzle.identity-test.config.ts --name=identity_initial` exited 0 with “No schema changes, nothing to migrate” and unchanged SQL hash. Future recipes require that clean prefix. Coordinator notified of this discovery. The live runner does not import drizzle-kit. Reviewed complete SQL and structured snapshot: 8 public tables, 61 columns, 8 PKs, 4 unique constraints, 11 checks, 10 FKs, 3 indexes. Only CREATE TABLE/INDEX and ALTER TABLE ADD FK; no drop/reset/seed/roles/grants or data changes. Auth FKs cascade user deletion for account/session; identity references restrict; active-admin is composite membership FK. SQL SHA-256 `2277a1d657eb88cd98de5ee99a46af70243c22350ae4a53bdb19d606bf46a2d4`, pinned by setup owner.
2. `bun --no-env-file test apps/server/src/test-support/identity-test-target.test.ts apps/server/src/test-support/identity-proof-target.test.ts` — initial 13 pass, 0 fail, 780 assertions; final 13 pass, 0 fail, 786 assertions after adding native-driver override denial. All synthetic/offline; missing-target subprocess prints only fixed failure and exits 1. No live test execution.
3. Targeted installed strict no-emit diagnostics — exit 0, no output:
   ```sh
   node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/test-support/identity-test-target.ts apps/server/src/test-support/identity-proof-target.ts apps/server/src/test-support/identity-proof-target.test.ts apps/server/src/modules/identity/enrollment.integration.ts packages/db/src/identity-proof-client.ts packages/db/drizzle.identity-test.config.ts
   ```
4. `env -i PATH="$PATH" HOME="$HOME" ZETTA_IDENTITY_TEST_PASSWORD=synthetic-config-validation-only docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests config --quiet` — exit 0, no output/secret rendering. Syntax/interpolation only, no daemon operation.
5. Structured Python SQL/snapshot review checks — passed table set/public scope/no destructive or data-changing SQL and printed constraint/index/FK metadata. `shasum -a 256` confirmed pinned hash.
6. A transient extra parenthesis while adding the native-driver override denial caused a parser failure (9 existing guard tests passed, new test file failed to parse; targeted TypeScript reported TS1109/TS1005). Corrected immediately; final exact guard and TypeScript commands above pass (13 tests/786 assertions, exit 0 diagnostics). Scoped Python checks pass final-newline/no-trailing-whitespace/no-NUL for all eight authored paths. Generated SQL/snapshot intentionally preserve the generator's missing final newlines. `git diff --check` passes and `git diff --cached --name-only` is empty. LSP unavailable; no builds/full suite. No files staged.

## Coordinator-only commands prepared, NOT executed by worker

Full private prompt/URL-encoding setup and teardown ordering are in the runbook. No secret values belong in command arguments/history/output. Keep any configured application DATABASE_URL available for comparison and deny ambient PG* settings.

```sh
# After private injection of ZETTA_IDENTITY_TEST_PASSWORD, test URL and mutation ack:
docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests up -d --wait --wait-timeout 60 postgres
# Sole guarded migration-apply + explicit focused-test command:
bun --no-env-file ./apps/server/src/modules/identity/enrollment.integration.ts
# Only this dedicated project; no -v/prune/root Compose:
docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests down --timeout 5
unset ZETTA_TEST_DATABASE_URL ZETTA_TEST_DATABASE_ALLOW_MUTATION ZETTA_IDENTITY_TEST_PASSWORD
```

No separate production `db:push`/migrate, arbitrary SQL CLI, migration mount or reset API. The live owner creates Drizzle's journal in addition to the eight generated public tables. Successful cleanup leaves the schema/journal until dedicated project teardown; rerunning against it is intentionally denied.

## Acceptance gates

- [x] Bounded source and reviewed offline generated initial SQL/snapshot prepared without widening production behavior.
- [x] Pure guard tests, targeted strict diagnostics and Compose config-only validation pass.
- [x] Initial source review and final corrections/live-evidence review accepted by coordinator; both found no issues.
- [x] Coordinator provisioned exact isolated service after review; secret-free identity/lifecycle evidence recorded.
- [x] Guarded apply and seven checks passed against real PostgreSQL, exit0 with all fixed PASS labels.
- [x] Dedicated project container/network cleanup confirmed; no persistent-stack/volume operation.
- [ ] Remaining parent 004c races/acceptance and root requirements completed separately.

Coordinator receipt: `/tmp/zetta-rfc004c2-live.md`; exact bounded orchestration `python3 /tmp/zetta-live-identity.py` provisions via the explicit Compose commands above, generates credentials privately, verifies dedicated ownership/tmpfs/loopback mapping, runs the guarded entry, and always tears down. PostgreSQL image ID `sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6`. Final result: seven SQL checks and cleanup passed, exit0. Failed attempts were all cleaned. Initial tmpfs permission and connectivity/readiness gates led to parent0755, separate bridge and explicit TCP healthcheck. Independent diagnosis confirmed PostgreSQL RESTRICT uses SQLSTATE23001 for the two referenced-member update/delete denials; only their exact expected codes changed, not missing-reference23503 assertions or schema/service behavior. Safe finite setup/check phases were added to suppressed-error diagnostics; the missing-target test now asserts the exact static target-validation message. Independent final review `/tmp/zetta-rfc004c2-final-review.md` found no issues and supports bounded acceptance. Coordinator final guards passed13 tests/786 assertions, exact strict no-emit command above and whitespace checks passed. Source and recorded live evidence are accepted; reviewer did not rerun the live commands. No production feature completion is claimed.

Remaining evidence limits: invitation acceptance/distinct-invitation/replacement-versus-issuance races; auth endpoint/cache behavior, actual operator provisioning, removal and UI. No production migration/auth activation or parent/root completion. Source and seven SQL checks do not substitute for these gates.

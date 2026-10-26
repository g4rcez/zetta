# Identity database verification: bounded local proof

[004c1](../../tasks/004c1-guard-disposable-identity-test-target.md) is the accepted pure boundary. [004c2](../../tasks/004c2-verify-live-identity-storage.md) adds source for the **first** PostgreSQL proof. The user explicitly authorized provisioning PostgreSQL via repository Compose and delegated infrastructure/isolation choices to the coordinator. This implementation worker performed **offline preparation only**; the coordinator owns provisioning, migration application, live execution and teardown **after independent review**. Coordinator execution and independent evidence review accepted the first seven SQL checks and [004c3](../../tasks/004c3-verify-invitation-transactions.md)'s seven additions: **14 checks passed, exit0, dedicated teardown confirmed**. Parent004c's SQL-only criteria are accepted. Root RFC-004 remains incomplete; no auth endpoint/session-cache/operator/UI proof is implied.

## Dedicated resources; never use the existing Compose stack

Use **only** `docker-compose.identity-test.yml`, explicitly selected with `--env-file /dev/null`, `-f` and `-p zetta-identity-tests`. Do not invoke root `docker-compose.yml`, its Axiom interpolation, persistent database `zetta`, `zetta-postgres` container or `zetta_postgres_data` volume. No `db:push`, production migration config, app startup, Better Auth E2E or env autoload is part of this proof.

The standalone file uses `postgres:18`, the dedicated role `zetta_identity_runner`, database exactly `zetta_identity_test`, port **127.0.0.1:55432**, a separate project-owned bridge network, and a 256 MiB tmpfs at `/var/lib/postgresql` (PGDATA `/var/lib/postgresql/18/docker`). The root-owned tmpfs parent uses mode0755 so the database user can traverse it; PostgreSQL initializes the nested data directory privately. Health checks explicitly use TCP127.0.0.1, not the temporary initialization Unix socket. The bridge is not an egress-denial boundary; this DB fixture is separate from the execution sandbox's network-none proof. It has no container name, bind/persistent volume, env file, checked-in password or application service. Limits: 384 MiB memory, one CPU, 100 PIDs, 12 connections, 32 MiB shared buffers; bounded healthcheck and shutdown. Stopping/recreating loses all PostgreSQL data; no reusable schema reset is offered.

The server startup option sets `zetta.identity_test_marker=zetta-identity-tests-v1`. Before migrations, **each** of three independent max-one-connection pools verifies the marker, PostgreSQL major 18, expected data directory, exact database, current/session user, and database ownership by that dedicated user. The marker is an intentional service identity check, **not cryptographic attestation**: the operator/coordinator must confirm this is the new isolated Compose instance. A malicious administrator or manually duplicated configuration can imitate it. No URL label alone proves ownership/disposability.

## Pre-client and driver boundary

`requireIdentityTestTarget` remains a pure injected-record guard with no IO/imports/ambient reads:

- Requires both `ZETTA_TEST_DATABASE_URL` and exact `ZETTA_TEST_DATABASE_ALLOW_MUTATION=identity-tests`. No application/service fallback and no passing skips.
- Allows PostgreSQL aliases, exact loopback host spellings, valid numeric/default port, exact raw `/zetta_identity_test`; rejects query/fragment, remote/multi-host/socket/encoded-host/extra-path/normalization tricks and controls.
- Compares any supplied application `DATABASE_URL`, ignoring credentials, aliases and conservative loopback equivalence, preserving database-name case. Uncomparable application URLs fail closed. **Supply it when configured; never unset it to evade comparison.**
- Returns a frozen endpoint-pinned `{ connectionString }` only. Never log/stringify it. All denials have the fixed `Identity database test target is unavailable or unsafe.` message with no input/cause.

The proof additionally calls `requireIdentityProofTarget(process.env)` **before dynamic driver/service imports**. It requires 127.0.0.1:55432, the dedicated username and a nonempty explicit password; localhost/IPv6/other ports remain valid for the general guard but are not this Compose proof. `NODE_PG_FORCE_NATIVE` and every ambient environment key starting `PG` (case-insensitive, even empty/unknown) are denied: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGPASSFILE/PGSERVICE/PGOPTIONS/PGSSL*/PGAPPNAME/etc cannot silently influence this run. Run with a deliberate clean environment; do not bypass configured application comparison.

The DB-local adapter resolves the already-installed `pg`/Drizzle dependencies without manifest changes. It reserves one verified backend from each independent pool until close (no idle eviction/reconnect can silently replace a verified service). It uses only the **returned normalized URL**, decoded into explicit host/port/database/user/password fields. SSL is explicitly off, SSL negotiation `postgres`, encoding UTF8, options fixed to `search_path=public`, logging off, application names fixed. No pg-native/service/passfile fallback is needed because credentials are mandatory and PG* is denied. Limits: connection 3 s, query 5 s, statement 4 s, lock 2 s, idle transaction 5 s, idle pool 1 s; max one connection per pool, finite keepalive. Idle pool errors become a failure flag without logging. A 90 s hard process deadline covers imports, setup, tests and `Pool.end`; OS socket closure bounds stuck cleanup. All pools are closed in finally. Output contains fixed test labels/fixed failure messages only, never URL/password, binds, driver causes or result objects.

## Offline checks (safe without PostgreSQL)

```sh
bun --no-env-file test apps/server/src/test-support/identity-test-target.test.ts apps/server/src/test-support/identity-proof-target.test.ts
```

This runs only pure synthetic guards, source-order checks and a clean missing-target subprocess whose network hooks throw. No client is imported/constructed on that denial. Do **not** run the live file to check configuration.

Compose syntax only, no daemon/container/image/network/database action, with a non-secret synthetic interpolation value and no rendered config:

```sh
env -i PATH="$PATH" HOME="$HOME" ZETTA_IDENTITY_TEST_PASSWORD=synthetic-config-validation-only \
  docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests config --quiet
```

Offline migration generation (already run once by worker; not application). Run from repo root:

```sh
(cd packages/db && env -i PATH="$PATH" HOME="$HOME" DOTENV_CONFIG_PATH=/dev/null \
  bun --no-env-file ./node_modules/drizzle-kit/bin.cjs generate --config=drizzle.identity-test.config.ts --name=identity_initial)
```

The pure config has exactly `./src/schema/index.ts`, output `./identity-test-migrations`, PostgreSQL/public, no credentials or varlock/env autoload. **The installed drizzle-kit CLI itself unconditionally loads dotenv**: Bun's flag alone does not disable that library. Always use the clean environment and `/dev/null` override above. Initial generation used the same command without that prefix; subsequent inspection found no `packages/db/.env` and no ambient dotenv path/key/debug/override selectors (no values/secret contents inspected). Corrected clean-environment regeneration passed with “No schema changes, nothing to migrate” and unchanged SQL hash. This is a recorded initial command limitation, not a claim of retrospective IO tracing. The standalone live runner does not import drizzle-kit. Reviewed initial generated files (never hand-edited):

- `packages/db/identity-test-migrations/20261022123627_identity_initial/migration.sql`
- `packages/db/identity-test-migrations/20261022123627_identity_initial/snapshot.json`

SQL SHA-256: `2277a1d657eb88cd98de5ee99a46af70243c22350ae4a53bdb19d606bf46a2d4`. Snapshot version 8: 8 public tables, 61 columns, 8 PKs, 4 unique constraints, 11 checks, 10 FKs, 3 indexes. SQL creates only `account`, `identity_audit`, `installation_identity`, `invitation`, `membership`, `session`, `user`, `verification`, indexes and FKs. Auth account/session deletion cascades to their owning user; identity FKs restrict deletion/update, including composite active-admin membership FK. No raw-token column, seed, role/database creation, grants, reset, drop or data mutation. Hash format/token generation/24-hour policy are service concerns, not additional SQL checks. Any generator change needs review and deliberate adapter hash update; do not hand-edit generated SQL/snapshot or blindly accept a hash mismatch.

## Coordinator-only live recipes — NOT RUN by worker

After independent source review, verify the dedicated project does not already contain an instance/data belonging to another run. The user authorized provisioning; the coordinator must still confirm the exact new resource and lifecycle. Do not inspect unrelated containers, secret files or app env. Do not render Compose config, print the environment, enable shell tracing, or paste credentials into arguments/history. The following assumes **Bash**, repository root, a private terminal, and no PG* environment keys. A configured application DATABASE_URL must remain supplied for comparison.

### 1. Private caller-provided throwaway credentials

```sh
set +x
read -r -s -p 'Throwaway identity test password: ' ZETTA_IDENTITY_TEST_PASSWORD
printf '\n'
[[ -n "$ZETTA_IDENTITY_TEST_PASSWORD" ]] || { printf 'Password required\n' >&2; exit 1; }
export ZETTA_IDENTITY_TEST_PASSWORD
# Capture URL-encoded credentials directly into the variable; never print the value.
ZETTA_TEST_DATABASE_URL="$(bun --no-env-file -e 'const u = new URL("postgresql://zetta_identity_runner@127.0.0.1:55432/zetta_identity_test"); u.password = process.env.ZETTA_IDENTITY_TEST_PASSWORD; process.stdout.write(u.href)')"
export ZETTA_TEST_DATABASE_URL
export ZETTA_TEST_DATABASE_ALLOW_MUTATION=identity-tests
```

Do not reuse production credentials. Container environment is accessible to the local Docker administrator; this is intentionally a throwaway local instance, not secret management for deployment. The empty-password branch exits that private shell rather than proceeding.

### 2. Provision only the dedicated DB service

```sh
docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests \
  up -d --wait --wait-timeout 60 postgres
```

The implementation worker performed no image pull or container startup. The coordinator subsequently pulled PostgreSQL18 and provisioned only this dedicated service under the user's permission, after source review. A startup/port/resource failure is a stop gate, not permission to change ports, disable guards, use another DB or invoke full Compose.

### 3. Guarded apply ONCE + focused live proof (one explicit command)

```sh
bun --no-env-file ./apps/server/src/modules/identity/enrollment.integration.ts
```

There is intentionally **no separate unguarded apply command** and no automatic `*.test.ts` live discovery. The standalone owner verifies all pool identities, obtains a fixed advisory lock, requires no user relations/routines/nonstandard schemas/extensions, validates the one reviewed migration folder and pinned SQL hash, then uses the installed Drizzle migration runner once. The runner creates its `drizzle.__drizzle_migrations` bookkeeping as well as the reviewed public tables. Nonempty targets fail, including a second invocation after a successful or interrupted apply. Recreate only this tmpfs service to rerun; never drop/reset `public` or clear a migration journal.

Before/after each test, recheck service identity and exact eight public table names, then `TRUNCATE` **all eight together**, without CASCADE or arbitrary names. The journal is retained. Tests add/drop only fixed `identity_proof_fail_audit` and `identity_proof_fail_membership` constraints (`CHECK(false) NOT VALID`) inside finally-protected fault scopes; actual audit/membership writes fail and their transactions must roll back. No trigger/function/mount/arbitrary SQL CLI is accepted.

Accepted first slice (preserved unchanged): 7 fixed PASS checks for actual singleton/status/removal/active-admin FK; invitation hash **uniqueness**, expiry/consumption/canonical email; audit actors/replacement reasons; bootstrap committed state; two real independent bootstrap connections held behind user-row locks until both passed the missing singleton read (one winner, no orphan activation/audit); bootstrap audit-failure rollback; replacement audit-failure restoration of pointer/membership/deleted sessions and subsequent successful replacement/session deletion/audit. Count/constraint assertions are actual SQL only when this command succeeds live. Missing config, unsafe target, timeout or any assertion fails exit 1, never a skip. Those seven checks are **not** live endpoint/Better Auth E2E, invitation-acceptance race proof, or full 004c/root acceptance. The current command also runs the seven 004c3 checks below; the complete accepted invocation passed exactly **14**, ending `PASS identity database proof (14 checks)`, with dedicated teardown.

### 4. Cleanup only this disposable project

Record secret-free exit status/PASS labels, then remove only this project:

```sh
docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests \
  down --timeout 5
unset ZETTA_TEST_DATABASE_URL ZETTA_TEST_DATABASE_ALLOW_MUTATION ZETTA_IDENTITY_TEST_PASSWORD
```

No `-v`, wildcard container removal, broad prune, root Compose or persistent-volume cleanup. Run cleanup even after test failure, while the throwaway password is still supplied for Compose interpolation. For a deliberate rerun, down then up the same dedicated file/project; stopping also destroys tmpfs. This cleanup is coordinator-owned, not auto-destruction by tests.

## Evidence limits

Worker evidence covers offline generation/review, guard tests, targeted strict no-emit diagnostics, Compose syntax-only validation and whitespace checks. Coordinator execution then passed all seven real PostgreSQL checks using the commands above, privately generated throwaway credentials and the hash-pinned migration. Confirmed exact dedicated project/service, loopback port, tmpfs/no persistent mounts and healthy state before the runner; confirmed no project container/network remained after teardown. Receipt: `/tmp/zetta-rfc004c2-live.md`; orchestration command: `python3 /tmp/zetta-live-identity.py` (temporary local helper, not a repository dependency).

Startup retries exposed parent-directory permission and host-connectivity/readiness issues; the final file has traversable parent0755, separate bridge and TCP healthcheck. A guarded diagnostic reproduced actual SQLSTATE23001 for referenced-row RESTRICT update/delete; only those two expected codes changed, while missing-reference checks retain23503 and exact constraint assertions. Safe phase-only diagnostics now locate setup/check failures without raw driver output. Final runner: **7 checks passed, exit0**, with dedicated container/network cleanup; generated SQL and service logic unchanged. Final independent review found no issues (`/tmp/zetta-rfc004c2-final-review.md`). Coordinator final guards passed13 tests/786 assertions; strict targeted diagnostics and whitespace checks passed. This bounded live slice is accepted; the reviewer did not repeat the live run.

Invitation races and both replacement/issuance orders subsequently passed with the complete14-check runner including membership-write rollback. Final review `/tmp/zetta-rfc004c3-final-review.md` supports acceptance of child004c3 and all three SQL-only parent004c criteria; stale wording identified by review is reconciled here. Root RFC-004 stays incomplete. Stored-session SQL rollback is not auth endpoint/cache proof.

## 004c3 invitation extension —14 passed and accepted

The existing guarded entry dynamically imports `enrollment-races.integration.ts` only **after** target validation and successful `openIdentityProof`. The extension is inert on import and is not a `*.test.ts` discovery target. It reuses the three reserved verified backends, fixture cleanup, real audit-fault constraint and fixed-label `run` helper; no production service/schema/client behavior or original seven assertions changed.

Seven additional exact PASS labels (each printed only after live assertions and cleanup succeed):

```text
PASS invitation issuance hashes canonical tokens and denies wrong account/user without consumption
PASS revoked and database-clock-expired invitations deny without activation
PASS two independent acceptance connections consume one token exactly once
PASS distinct invitations for one user serialize with losing token unconsumed
PASS acceptance audit SQL failure rolls back consumption and activation; removed joined-at survives retry
PASS acceptance membership SQL failure rolls back claim and preserves absent or removed membership
PASS replacement versus old-admin issuance honors both forced lock orders and new authority
```

Issuance checks canonical 32-byte base64url and SHA-256 correspondence only in memory, lowercase binding and exact DB 24-hour lifetime. Wrong-email and matching-email/wrong-exact-user denials leave no consumption/membership/audit. Expiry uses a fixture SQL clock update with creation two days ago and expiry one day ago, maintaining strict expiry-after-creation; no wall-clock sleep.

For each acceptance race, the owner holds singleton1 while both independent contenders are positively observed in `pg_stat_activity` blocked on singleton queries with nonempty `pg_blocking_pids`. Release allows exactly one success and one fixed opaque enrollment error, one target membership, one consumption and one linked audit. The existing service intentionally rejects active membership **before** claiming: distinct invitations for the same user therefore leave the loser unconsumed, not two successful acceptances and not an invented rollback fault.

The supplemental membership-write case uses a real fixed `CHECK(false) NOT VALID` on membership, for both absent and removed state; after activation fails it requires full token/membership/audit restoration, removes the constraint in finally and retries successfully. Its source review found no issues and the coordinator's14-check live run passed; final evidence review supports acceptance.

Audit failure is a real SQL constraint failure after claim/activation, checked for both absent and removed memberships. Token and audit snapshots remain unchanged; removed membership fully restores and retry preserves original joined-at while clearing removal. No schedule/readiness objects exist in the schema: these assertions prove identity state only, **not** automatic schedule/readiness restoration or its absence in a running application.

Replacement/issuance checks both forced orders. An owner account-row lock stalls the first contender after it owns singleton1; positive `pg_blocking_pids` observations establish first-to-owner account blocking, then second-to-first singleton blocking. Both must reach the intended block within one shared 1.5-second polling budget (below the 2-second lock timeout); release and settle before fixture cleanup. Issuance-first commits before replacement; replacement-first denies old-admin issuance. Thereafter old admin always fails opaquely and new admin can issue; exact pointer, membership, invitation issuer and audit counts are checked. Every concurrent service promise is immediately observed with `allSettled`; owner rollback is in finally, with settling in nested finally even if rollback fails. Existing query/statement/lock limits and the 90-second whole-run deadline including close remain unchanged. Raw tokens, hashes, emails, assertion details, binds and driver errors are never printed.

Coordinator source review initially found cached activity snapshots and non-isolated email coverage. A separate awaited `pg_stat_clear_snapshot()` now precedes every poll; an ID-matching/email-mismatching account attempt independently proves email binding. Follow-up review resolved both findings. The coordinator then ran all13 checks successfully, exit0 with dedicated teardown; no production logic/schema changed. The membership-write fault supplement above is added to meet the remaining explicit SQL contract item; final offline34 tests/1454 assertions and strict diagnostics passed. Supplement source review found no issues; current guarded14-check invocation passed, exit0 with exact dedicated project container/network cleanup. Receipt `/tmp/zetta-rfc004c3-live.md` includes exact commands and PASS labels. Final independent artifact review accepted the evidence, subject only to wording corrections now reconciled. Coordinator accepts child004c3 and parent004c SQL-only scope; reviewer did not repeat live execution.

**Coordinator handoff:** the provisioning/private credentials, guarded command and dedicated teardown recipes above are unchanged. The temporary `/tmp/zetta-live-identity.py` helper was updated before the accepted run: it preserves the first seven labels, includes the seven above and requires `PASS identity database proof (14 checks)`. Do not silently retain its seven-check expectation or edit repository provisioning to compensate. Run only after independent source acceptance; record real exit/PASS/cleanup evidence separately. New offline checks cover post-open dynamic import ordering and inert extension import with throwing network/startup hooks. Source preparation is not permission for the worker to connect, and this extension alone did not close parent004c: actual14-check execution, teardown and final independent evidence review satisfied its SQL criteria. RFC-004 and auth endpoint/session-cache/operator/UI behavior remain outside this proof.

# RFC-004c3: Prepare bounded invitation transaction/race proof

- **Parent:** [004c](004c-verify-identity-database-constraints.md), within root RFC-004.
- **Prerequisites:** accepted [004c2](004c2-verify-live-identity-storage.md) disposable infrastructure/seven live SQL checks; accepted inactive [004b](004b-implement-transactional-enrollment.md) and [004e1](004e1-implement-admin-lifecycle-transactions.md) services.
- **Status:** accepted after source/follow-up/supplement reviews, coordinator14-check execution/cleanup and final evidence review. Parent004c SQL-only slice is accepted; root RFC-004 remains incomplete.

## Boundary

Implementation worker scope was single-writer offline preparation only. No worker database connection, Docker/network operation, build, install/dependency/schema/API/auth activation, production service change, agents, staging or commits. Existing application persistence and accepted seven SQL assertions remain untouched. The accepted dedicated provisioning, target guard, migration/hash, three reserved independent backends, query/statement/lock timeouts, whole-run90s deadline and teardown are reused unchanged. No generic framework, public API or reset facility was added.

## Changed paths

- `apps/server/src/modules/identity/enrollment-races.integration.ts`: bounded explicit-run-only extension with exported test-only `InvitationRaceProof` interface, existing concrete enrollment/admin services, synthetic accounts, SQL committed-state assertions and bounded positive-control lock barriers.
- `apps/server/src/modules/identity/enrollment.integration.ts`: dynamically imports extension only after current pre-client guard and successful dedicated proof open; invokes it after accepted seven checks using current `run`/`failAudit` helpers; changes the final total from7 to14. Original seven assertions unchanged.
- `apps/server/src/test-support/identity-proof-target.test.ts`: extends source-order test for post-open import/current14 total; adds clean inert-extension import subprocess with throwing network/listen/fetch/timer hooks. Missing-target diagnostic expectation remains exactly `Identity database proof failed at target validation; details suppressed.`
- `docs/verification/identity-database.md`: preserves accepted004c2 evidence and exact provisioning/private credential/run/cleanup recipes; documents seven added labels, actual14-check evidence, limits and temporary coordinator harness update.
- This child record only. No parent/root task records or sandbox002 files changed.

## Seven prepared SQL checks / exact new PASS labels

```text
PASS invitation issuance hashes canonical tokens and denies wrong account/user without consumption
PASS revoked and database-clock-expired invitations deny without activation
PASS two independent acceptance connections consume one token exactly once
PASS distinct invitations for one user serialize with losing token unconsumed
PASS acceptance audit SQL failure rolls back consumption and activation; removed joined-at survives retry
PASS acceptance membership SQL failure rolls back claim and preserves absent or removed membership
PASS replacement versus old-admin issuance honors both forced lock orders and new authority
```

Expected current successful runner: all original seven labels plus these seven, ending **`PASS identity database proof (14 checks)`**. These are expected labels, not worker live output.

Checks cover SHA-256 equality to canonical returned 32-byte base64url token only in memory; lowercased invitation email/exact user binding; 24-hour SQL lifetime; wrong-email and matching-email/wrong-exact-user denials without consumption, activation or consumed audit; real revoke and DB-clock-expired token denial. Expiry is set through SQL to creation two days ago/expiry one day ago, preserving `expires_at > created_at`, with no wall-clock wait.

Acceptance races hold singleton1 on owner until **both** independent backend PIDs are positively observed waiting on singleton queries with nonempty `pg_blocking_pids`. Release must produce exactly one success and one fixed opaque enrollment error, exact membership and consumption/audit counts and linked audit references. The existing service serializes at singleton and denies active membership before claiming: **distinct invitations for the same user have one winner; the losing invitation stays unconsumed**. No invented forced rollback/two-success policy is imposed.

Real audit-fault acceptance checks absent and removed memberships. Failed audit insertion must restore the full invitation and audit state, leave absent membership absent and preserve the exact removed membership row. After fault removal, retry activates once and preserves removed-user joined-at. No schedules/readiness schema objects exist; this slice proves identity SQL only, not application restoration behavior.

Replacement versus issuance runs both forced orders. Owner locks old account; first contender must be observed blocked by owner on its account query after acquiring singleton. Only then second starts and must be observed blocked by first on singleton. One shared1.5s barrier budget stays below existing2s lock timeout; statement4s/query5s/hard90s limits remain. Issuance-first commits before replacement; replacement-first denies old actor. Both orders then require old actor denial, new admin issuance and exact pointer/membership/issuer/audit counts. Safe return keys and fixed enrollment errors are asserted; no raw token/hash/email/driver/assertion output is emitted. Unexpected admin/service errors remain suppressed by the existing guarded entry rather than printed.

All concurrent service promises are immediately observed with `Promise.allSettled`; owner rollback is in finally and settling in nested finally, before shared fixture cleanup. Existing close/finally and hard deadline remain responsible for bounded connection release. Fixtures use only synthetic identities.

## Independent pre-live review corrections

Initial review `/tmp/zetta-rfc004c3-review.md` blocked cached activity-query snapshots inside the owner transaction. The coordinator added a separate awaited `select pg_stat_clear_snapshot()` before every activity poll; relation/blocker-PID checks, shared1.5s budget and lock/cleanup guarantees remain unchanged. Review also found email denial was not independently isolated; the existing wrong-user-bound invitation now additionally denies its matching user ID with a mismatching account email before zero-consumption/state assertions. No production service logic changed. Focused re-review `/tmp/zetta-rfc004c3-followup-review.md` resolved both findings. Coordinator then ran the complete13-check version against a freshly provisioned dedicated service; all labels passed, exit0, exact container/network cleanup confirmed.

Parent004c explicitly also requires membership-write failure rollback. Coordinator appended one real `membership CHECK(false) NOT VALID` fault check for absent and removed membership, with finally-protected constraint removal, full invitation/membership/audit restoration, no consumption and successful retry preserving joined-at. No production logic changed. Summary/guard/temp allowlist now require14. Focused source review `/tmp/zetta-rfc004c3-membership-review.md` found no issues. Coordinator then ran all14 checks successfully, exit0 with exact dedicated container/network cleanup; final review `/tmp/zetta-rfc004c3-final-review.md` supports acceptance with stale wording reconciled. Coordinator's final offline rerun passed34 focused tests/1454 assertions plus exact strict no-emit and whitespace checks.

## Offline validation actually run

1. `bun --no-env-file test apps/server/src/test-support/identity-test-target.test.ts apps/server/src/test-support/identity-proof-target.test.ts apps/server/src/modules/identity/enrollment.test.ts apps/server/src/modules/identity/admin-lifecycle.test.ts` — **34 pass,0 fail,1454 assertions**, Bun1.3.14. Synthetic tests only; no live entry success invocation.
2. `bun --no-env-file test apps/server/src/test-support/identity-test-target.test.ts apps/server/src/test-support/identity-proof-target.test.ts` — **14 pass,0 fail,791 assertions**. Includes preserved exact missing-target diagnostic and inert extension import with no client.
3. `bun --no-env-file test apps/server/src/modules/identity/enrollment.test.ts apps/server/src/modules/identity/admin-lifecycle.test.ts` — **20 pass,0 fail,663 assertions**. Production service sources unchanged.
4. Installed targeted strict no-emit diagnostics — exit0/no output:
   ```sh
   node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/test-support/identity-test-target.ts apps/server/src/test-support/identity-proof-target.ts apps/server/src/test-support/identity-proof-target.test.ts apps/server/src/modules/identity/enrollment.integration.ts apps/server/src/modules/identity/enrollment-races.integration.ts packages/db/src/identity-proof-client.ts
   ```
5. Python source check confirms13 unique fixed labels, correct post-guard/post-open dynamic import ordering and exact13 total. Scoped whitespace/final-newline checks and `git diff --check` pass; `git diff --cached --name-only` is empty. LSP unavailable; no full build/suite.

## Coordinator-only handoff — NOT executed by worker

The exact approved private credential setup and provisioning/run/cleanup commands in the [runbook](../docs/verification/identity-database.md) are unchanged. After independent source review and private credential injection:

```sh
docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests up -d --wait --wait-timeout 60 postgres
bun --no-env-file ./apps/server/src/modules/identity/enrollment.integration.ts
docker compose --env-file /dev/null -f docker-compose.identity-test.yml -p zetta-identity-tests down --timeout 5
unset ZETTA_TEST_DATABASE_URL ZETTA_TEST_DATABASE_ALLOW_MUTATION ZETTA_IDENTITY_TEST_PASSWORD
```

Cleanup must run even on failure while password remains available; no root Compose, persistent target, `-v`, prune, schema reset or alternate migration command. The pinned apply-once migration still requires a newly recreated empty disposable service for each invocation.

**Before live execution, coordinator must update temporary `/tmp/zetta-live-identity.py`**: retain original seven allowed PASS labels, append the seven exact labels above, and require final14 count instead of7. Worker did not edit/run that external harness. Record real SQL result and exact dedicated container/network teardown separately; offline preparation cannot substitute for it.

## Acceptance gates / evidence limits

- [x] Bounded source extension and shared guarded invocation prepared without changing accepted services/schema/infrastructure/seven assertions.
- [x] Focused native offline tests, strict targeted diagnostics and scoped source checks pass.
- [x] Independent source/follow-up/supplement review accepted for coordinator execution.
- [x] Coordinator's exact dedicated live apply/run yielded all14 checks and exit0.
- [x] Dedicated project teardown confirmed and secret-free live evidence independently reviewed.
- [x] Parent004c SQL acceptance completed separately; root RFC-004 requirements remain outside this child and incomplete.

Coordinator live receipt: `/tmp/zetta-rfc004c3-live.md`; exact orchestration `python3 /tmp/zetta-live-identity.py`, guarded runner and dedicated lifecycle above. All14 fixed checks passed with exit0/empty stderr and scoped teardown, including refreshed-activity lock barriers, real audit/membership-write faults and committed retry state. Membership CHECK failure may reject an INSERT tuple before ON CONFLICT update; no UPDATE-specific fault claim. Final independent artifact review accepted all named SQL evidence with only stale wording corrections. Those are reconciled; coordinator accepts this child and SQL-only parent004c. Source review does not equal SQL execution; stored SQL membership/session evidence never proves HTTP/Better Auth/session-cache behavior, operator authentication or schedule/readiness restoration. Original seven004c2 checks remain accepted historic evidence, not evidence that these six new checks passed.

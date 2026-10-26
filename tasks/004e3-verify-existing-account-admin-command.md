# RFC-004e3: Verify the existing-account admin command

- **Parent:** [004e](004e-bootstrap-and-recover-installation-admin.md), within RFC-004.
- **Prerequisite:** [004e2](004e2-run-existing-account-admin-command.md) source acceptance, including its independently reviewed shutdown correction.
- **Status:** implemented and runtime verified. Parent RFC-004/004e remain incomplete. This new slice has coordinator source review; no new independent review has run.

## Authority and scope

On 2026-10-22 the user requested continuation from the checkpoint. The recovered pi session finished 004e2 and stopped. This continuation resumed the next bounded slice under the recorded authorization to create and run the disposable verification lifecycle autonomously. The actual target was only `docker-compose.identity-test.yml`, project `zetta-identity-tests`, PostgreSQL 18, database `zetta_identity_test`, role `zetta_identity_runner`, loopback port 55432 and tmpfs storage. No existing project resources were adopted; the existing local image was used without pulling. No application database or real account was selected.

## Changed paths and contract

- `apps/server/src/modules/identity/admin-operator.integration.ts`: inert-on-import standalone runner; accepted target guard precedes runtime imports, then pinned test migration, synthetic user/session rows, real CLI subprocesses, exact opaque output and SQL assertions. Six checks; 25-second child and 90-second overall deadlines; output capped at 4096 bytes per stream. Children are killed/settled before fixture cleanup; the deadline covers close.
- `apps/server/src/modules/identity/admin-operator.integration.test.ts`: import/missing-target subprocess check with network and timers forbidden.
- `scripts/verify-identity-auth.sh`: fixed `auth|operator` dispatch. No argument retains the existing auth proof; unknown/extra arguments deny before Docker. Existing private credentials, ownership, empty-project, local-image, tmpfs and teardown controls are reused.
- `scripts/verify-identity-auth.test.ts`: operator dispatch, failed-proof teardown and unknown-mode denial alongside existing auth launcher coverage. These fake Docker/Bun checks are offline evidence only.
- `packages/db/src/identity-proof-client.ts`: reuses the accepted ownership helper for all three reserved connections. Close awaits every owner and checks final health, replacing reliance on early-resolving `pool.end()`. Target checks, migration hash and fixture cleanup are unchanged.
- Task, parent, checkpoint and operator runbook records link the resulting evidence.

No operator implementation, auth configuration, production wiring, manifest, dependency, lockfile or migration source changed. The audit-failure constraint exists only in the verified disposable instance and is removed in `finally`.

## Completion record

### Offline verification

The new tests first failed for the missing proof module and absent operator dispatch: 6 pass, 2 fail. After implementation:

```sh
bun --no-env-file test apps/server/src/modules/identity/admin-operator.integration.test.ts apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.test.ts scripts/verify-identity-auth.test.ts
```

**27 pass, 0 fail, 366 assertions across four files.** Includes prior shutdown regressions and unchanged default auth launcher behavior. The accepted live auth proof was not rerun.

```sh
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/admin-operator.integration.ts apps/server/src/modules/identity/admin-operator.integration.test.ts packages/db/src/identity-proof-client.ts scripts/verify-identity-auth.test.ts
bash -n scripts/verify-identity-auth.sh
git diff --check
```

Passed. LSP reported no diagnostics for the proof runner/client. The shell LSP request timed out; Bash syntax passed. The skill rule-audit executable requires TypeScript 7 `typescript/unstable/async` and `typescript/unstable/ast`, absent from installed TypeScript 6.0.3; its attempt exited 2. No dependency was installed for that tool. Strict diagnostics and manual source review found no new assertions, suppressions or untyped escape hatches. Each changed source file remains below 200 nonblank/noncomment lines and has one responsibility: CLI/SQL verification, target-owned DB setup, or fixed launcher dispatch.

### Actual runtime verification

```sh
bash scripts/verify-identity-auth.sh operator
```

Exit **0**. Observed receipt:

```text
PASS dedicated Compose ownership, loopback port, tmpfs-only storage and health
PASS dedicated PostgreSQL data filesystem is tmpfs
PASS CLI help configuration and input denials preserve all rows
PASS selected existing account bootstraps with one operator audit
PASS repeated bootstrap and stale or missing replacement deny unchanged
PASS audit failure rolls back pointer memberships sessions and audit
PASS replacement preserves membership history and unrelated stored session
PASS two independent blocked bootstrap commands commit one winner
PASS actual admin operator CLI proof (6 checks); synthetic rows only
PASS dedicated Compose container/network cleanup; no volume removal
```

The race holds both candidate user-row locks, starts two independent CLI processes, observes both real `FOR UPDATE` waiters blocked by the owner, then releases. One success, one operation denial, one singleton, one matching active membership and one audit are required. Observation uses bounded SQL reads, without scheduling sleeps.

The rollback case adds proof-owned `CHECK(false) NOT VALID` on audit inserts, invokes replacement, requires denial and equality of full user/account/verification/member/singleton/invitation/session/audit snapshots, then removes the exact constraint. A separate deliberate replacement succeeds. It verifies original join-date preservation, former admin's ordinary active membership, both selected users' stored-session deletion, third-user session retention and exact safe audit fields.

### Limits and next consumer

Synthetic direct user/session inserts are **not credential provisioning or login evidence**. This proof does not establish effective cookie/cache revocation, in-flight requests, browser/native transport, production operator privileges or invitation-versus-replacement concurrency. It establishes actual CLI success/denials, real rollback, stored-session scope and the named bootstrap race on the owned test service.

Next: trusted credential-provisioning contract, effective auth-session revocation, then [004f](004f-connect-enrollment-status-and-login.md) enrollment/access integration. No plugin/schema/auth change is implicitly approved by this receipt. Parent RFC-004/004e remain incomplete; independent review of the new slice remains for their integration gate. No staging, commit, deployment, broad suite/build or production action occurred.

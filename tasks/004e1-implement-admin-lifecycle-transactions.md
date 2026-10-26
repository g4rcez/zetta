# RFC-004e1: Implement admin lifecycle transactions

- **Parent:** [004e](004e-bootstrap-and-recover-installation-admin.md), within root RFC-004.
- **Prerequisites:** accepted 004a schema, 004b singleton-first lock contract and 004d1 separation of ordinary signup from operator provisioning.
- **Status:** root parent row is authoritative; child records source evidence only.

## Goal

Implement concrete transactional bootstrap/replacement for already-provisioned account IDs, inactive and reachable only through future trusted operator composition. Credential provisioning and the operator command remain 004e work.

## Non-goals

No public/admin HTTP route, credential creation or guessed password hashing, executable operator entry point, database connection/migration, auth wiring, ownership transfer or claim of operator authentication from an input flag.

## Bounded paths and contract

New `apps/server/src/modules/identity/admin-lifecycle.ts` and `.test.ts` only, plus this record. Use accepted schema and installed Drizzle, the existing DB query helper module and type-only Database imports. No startup side effects or generic storage framework. Split again if one transaction seam cannot stay bounded.

Expose clearly named internal operator-only operations for exact existing user IDs. A boolean/string claiming operator status is never authority. Future CLI composition must establish operator control; this service is not a public trust boundary.

Bootstrap: lock/verify target account and create active membership (or explicitly reactivate removed state without resuming schedules/readiness), singleton 1 and operator audit atomically. A singleton collision fails generically and rolls back membership; no first-login promotion. Existing active membership may become the explicitly designated admin. Concurrent absence cannot be protected by locking a missing row alone; use the unique singleton insertion/transaction outcome and reserve concurrency proof for 004c.

Replacement: lock singleton FIRST in the same protocol as 004b, require current old ID to match exactly and new ID to differ, validate/lock account rows deterministically, activate/lock target membership and change pointer before invalidating the previous active-admin membership if ever needed. Preserve previous admin as ordinary active member. Delete both affected users' sessions, write operator audit with nonblank reason, and commit atomically. No private content/connection transfer. Recheck target/current identity inside transaction; no driver cause or sensitive values in returned errors. Keep safe result projection and no logs.

## Acceptance criteria

- [ ] Concrete Drizzle transaction code creates one explicit singleton/admin/audit for a selected existing identity and rolls back failures without granting implicit membership/admin authority.
- [ ] Replacement honors singleton-first locking, expected old/new IDs, nonblank operator reason, session invalidation for both IDs, unchanged private data and atomic audit.
- [ ] Native offline tests inspect genuine SQL, bounded outputs, denials and rollback ordering without claiming real FK/locking/concurrency/session-cache proof.

## Verification

Run `bun test apps/server/src/modules/identity/admin-lifecycle.test.ts`, targeted strict no-emit diagnostics and whitespace checks. No DB/network/provider/actual bootstrap/migration/build/full-suite command. Record LSP absence and source-only fixture limits.

## Definition of done and handoff

Independent review and coordinator confirmation accept source only. Record exact signatures/locking/error contracts for future operator CLI and real SQL/auth verification. Root RFC-004 and 004e remain incomplete until runtime and connected operator evidence.

## Completion record

Accepted as inactive source — independent source/installed-API review found no issues. Coordinator independently reran `bun test apps/server/src/modules/identity/admin-lifecycle.test.ts`: 10 pass, 0 fail, 379 assertions (171 ms). Root RFC-004 and parent 004e remain incomplete and were not changed.

Approvals/prerequisites: user's bounded identity-source work, selected-existing-account bootstrap/replacement and native single-file test approval; accepted 004a schema, accepted 004b singleton-first transaction contract, accepted 004d1 ordinary-signup/operator-provisioning separation, ownership policy and tasks/README.md. Installed/lockfile versions remain Drizzle 1.0.0-rc.4, TypeScript 6.0.3 and Bun 1.3.14. No incompatible installed API or new policy decision was needed.

Changed paths:
- `apps/server/src/modules/identity/admin-lifecycle.ts` (new): concrete installed Drizzle transactions through existing `@zetta/db/query` and schema modules; type-only `Database` import.
- `apps/server/src/modules/identity/admin-lifecycle.test.ts` (new): ten native Bun tests using installed Drizzle and an offline pg-query-protocol boundary, following enrollment.test.ts.
- Only this child's completion record. No parent/root, schema/auth, composition, helper/export, manifest or lockfile changes. Existing unrelated modifications/untracked files are preserved; nothing staged.

Exported contract for future trusted operator composition:
- `createAdminLifecycleService(db: Pick<Database, "transaction">)` returns two asynchronous internal methods. This is NOT operator authentication or a public trust boundary. Future composition must establish installation-operator control before constructing/calling it; no `isOperator`, role, session actor or ordinary signup input grants access. No route/CLI/provisioning is supplied.
- `bootstrapExistingAccount(input: unknown): Promise<{ adminUserId: string }>` accepts exactly `{ userId: string }` for an explicitly selected existing auth-user ID. Nonempty IDs must have no surrounding whitespace and are matched exactly; no email lookup, default first account or credential creation exists.
- `replaceAdminWithExistingAccount(input: unknown): Promise<{ previousAdminUserId: string; adminUserId: string }>` accepts exactly `{ expectedAdminUserId: string, newAdminUserId: string, reason: string }`. IDs obey the same exact-ID contract and must differ. Reason must be nonblank after trimming; only the trimmed reason is stored in the operator audit, never returned. Callers must provide a safe operational reason, not passwords, session values or private content. Extra body authority fields and malformed inputs fail before opening a transaction.
- `AdminLifecycleUnavailableError` is the sole failure class/message for invalid input, missing/stale identities, already-bootstrapped state, collisions and storage/commit failures. Its fixed message asks the installation operator to verify current admin/selected accounts before retrying. No driver cause, SQL parameters, secret detail or distinguishing denial is propagated; no logs. Results contain only the safe IDs above and are returned after Drizzle commit resolves.

Transaction/locking contract:
- Both methods use explicit `read committed` Drizzle transactions. Both select singleton ID 1 `FOR UPDATE` first. Bootstrap rejects an existing pointer, locks/rechecks the selected stored user, locks its membership, activates it if absent/removed, inserts singleton ID 1 and writes an operator `bootstrap` audit in the same transaction.
- Bootstrap does NOT claim an absent-row lock excludes another attempt. The unique singleton insertion decides success; it has no conflict-ignore/update path. Collision/error/no returned singleton fails and Drizzle rolls back attempted membership activation. Live uniqueness/concurrent-winner proof remains 004c.
- Replacement locks/rechecks singleton FIRST, requiring its current admin to equal `expectedAdminUserId`. Within that singleton lock it locks both account rows in lexical ID order, then both membership rows in lexical ID order; reversed old/new roles retain the same order. Both accounts must still exist and the current admin membership must be active. The common singleton lock serializes this with accepted 004b enrollment even though subsequent account/member locks are grouped/sorted here.
- Target membership is retained unchanged if already active. Otherwise insert/upsert is conditional on removed status, clears removed time, updates identity timestamp and preserves existing joined time; missing activation result fails. No schedules/readiness are resumed.
- Only after target activation, replacement updates singleton pointer conditionally on ID 1 AND the expected old admin, requires its returned new ID, deletes ALL stored sessions for BOTH old/new users in one bound DELETE, and writes an operator `admin-replacement` audit with the required reason. Pointer bootstrap timestamp is not reset. Previous admin membership remains ordinary active, unchanged. No private resources, ownership, invitations, schedules, workflows, readiness or connections are touched/transferred.
- Audit fields use the accepted operator actor (null user actor), selected/new subject, null invitation and DB clock; no fabricated operator user or secret payload. Audit/session errors roll back the same transaction. No session/token data is projected.

Exact focused validation history:
1. `bun test apps/server/src/modules/identity/admin-lifecycle.test.ts`: initial run 9 pass/1 fail, 361 assertions. One expected-SQL test omitted installed Drizzle RC's nested predicate parentheses. Corrected the test expectation for actual bound AND/OR SQL; production behavior was unchanged.
2. Same exact command: 10 pass, 0 fail, 374 assertions (87 ms). Strict targeted diagnostics below also passed, exit 0/no output.
3. After adding exact membership SELECT/activation parameter/projection assertions, final same single-file command: **10 pass, 0 fail, 379 expect() calls**, one file (168 ms), Bun 1.3.14.
4. Final installed strict no-write diagnostics: exit 0, no output:
   ```sh
   packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/admin-lifecycle.ts apps/server/src/modules/identity/admin-lifecycle.test.ts
   ```
5. LSP tools are unavailable in this worker. Targeted installed diagnostics include imported types, not a whole-project typecheck/build. `git diff --check`, explicit new-file whitespace checks for the three changed paths, and an empty `git diff --cached --name-only` verify whitespace/no staged files.

Evidence and limits:
- Actual installed Drizzle SQL/transaction builder generates the bound SELECT/INSERT/UPDATE/DELETE, `FOR UPDATE`, conditional membership upsert/pointer, safe RETURNING, DB-clock, BEGIN/read-committed, COMMIT and ROLLBACK protocol assertions. Tests cover absent/existing/removed/active selected membership, missing target account/bootstrap, repeated bootstrap, simulated unique collision, stale expected admin, same IDs, blank/invalid reason, extra authority fields, missing old/new accounts/inactive current membership, reversed lexical lock order, both-user session deletion, unchanged prior membership and no unrelated resource writes.
- Injected membership/audit/session/commit failures and no-return activation/pointer cases exercise actual Drizzle rollback orchestration; the fixture snapshots/simulates state restoration, not physical database rollback. The collision is an injected query error, NOT a parallel-database race test. There is no claim of PostgreSQL constraints/FKs/locks/concurrency/physical atomicity or actual cached-session revocation proof.
- Import isolation launches fresh Bun with `--no-env-file`, only NODE_ENV=test and throwing TCP/TLS/fetch/listen/timer guards. The module imports successfully with no auth/services/env/connection startup. The fixture resolves Drizzle through the dependency owner's installed package, never a hard-coded node_modules path; no Pool is instantiated.

Remaining gates/recovery handoff:
- Independent source review and coordinator confirmation are accepted; the reviewer did not execute commands. 004c must separately prove approved disposable PostgreSQL constraints, singleton collision/concurrency, lock coordination with invitation issuance/acceptance and physical rollback. Session deletion in SQL is not proof of Better Auth cookie/secondary-cache invalidation or in-flight session handling; future live-auth integration must verify both users lose effective sessions.
- 004e retains trusted operator entry point/control, installed credential provisioning API verification, safe operational runbook and approved connected runtime evidence. Ordinary invitation signup/preflight remains separate and cannot bootstrap/promote. Never expose these internal functions as unauthenticated/public routes or substitute an input flag for operator control.
- On unavailable/uncertain commit outcome, the operator must inspect current pointer/account state through an approved trusted procedure before retrying; no blind success claim/retry or default admin selection. Replacement's exact expected-old check is retained for stale retries. Source output contains no credentials/private content.
- Skipped as required: DB/network/provider calls, actual bootstrap/signup/auth activation/provisioning, generators/migrations, installs/manifests/lockfiles, build/full-suite/E2E, worktrees, staging/commits/deployments. Parent/root completion is not unblocked by source fixtures alone.

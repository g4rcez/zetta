# RFC-004b: Implement transactional enrollment

- **Parent:** [RFC-004](004-implement-approved-enrollment-and-admin-bootstrap.md).
- **Prerequisites:** accepted [004a](004a-define-identity-storage.md).
- **Status:** parent row in [TASKS.md](../TASKS.md) is authoritative.

## Goal

Implement real transactional invitation issuance, revocation and acceptance against the accepted identity schema, without wiring public routes or changing auth yet.

## Non-goals

No fake production store, generic storage framework, migrations/DB connection, auth hooks, operator provisioning, routes, UI, new dependency or claim of proven PostgreSQL concurrency.

## Contract and bounded paths

Read [ownership](../docs/decisions/ownership.md), [execution rules](README.md) and 004a handoff. Proposed paths: `apps/server/src/modules/identity/enrollment.ts`, `enrollment.test.ts`, and a focused concrete `store.ts`/test if needed. Split again before exceeding one coherent transaction seam; do not grow a general repository abstraction.

Use 32 cryptographically random bytes encoded base64url, SHA-256 at rest, 24-hour expiry, lowercase email only and exact existing-user binding when specified. Resolve identity from the trusted session/stored account, not body owner/role values. Token possession plus the matching account is the approved minimum intended-account proof; do not introduce email providers/verification.

Admin issuance/revocation must lock/recheck active sole-admin identity inside the transaction. Acceptance uses a transaction and consistent lock ordering; recheck current account identity, singleton, unrevoked/unconsumed/unexpired matching invitation, and duplicate membership. Claim/consume, membership activation and audit commit together or roll back. Reject already-active membership without burning a token. Re-enrollment must not reactivate schedules/readiness. Return generic invalid/unavailable errors without invitation/account enumeration. Production code must use the concrete accepted Drizzle schema/transaction APIs; fixtures can substitute the narrow execution boundary only for testing.

## Acceptance criteria

- [ ] Issue/accept/revoke preserve account binding, expiry and single-use semantics; role/user forgery and stale admin authority are rejected.
- [ ] Production transaction code includes conditional claims, locking and audit atomicity; no preflight-only success or after-hook consumption.
- [ ] Pure fixtures cover denial, boundary expiry, replay, duplicate membership and rollback orchestration without claiming they prove actual database locks.

## Verification

Focused commands: `bun test apps/server/src/modules/identity/enrollment.test.ts` and a new store test only if that file is created. Targeted no-write diagnostics; no DB connection, full suite, build or provider call. Real DB concurrency belongs to 004c.

## Definition of done and handoff

Record actual exported services, safe error contracts, transaction assumptions, focused evidence and remaining PostgreSQL proof. Independent review required; do not expose or activate before 004c/004d/004f integration. Parent remains incomplete.

## Completion record

Accepted as an inactive source slice — independent source/installed-library review found no issues. Coordinator reran `bun test apps/server/src/modules/identity/enrollment.test.ts`: 10 pass, 0 fail, 284 assertions (103 ms). Parent RFC-004 remains incomplete. No public enrollment/auth behavior is activated.

Approval/prerequisites: accepted 004a schema/handoff; approved ownership policy; user's presented identity-source work, focused native Bun tests, lowercase-only account matching and 24-hour invitation defaults. During implementation, strict diagnostics demonstrated that the server cannot resolve `drizzle-orm` (not its dependency). The coordinator explicitly approved the smallest integration extension: one side-effect-free `packages/db/src/query.ts` exporting only `and`, `eq`, `gt`, `isNull`, `or`, `sql` through the existing DB wildcard export. No manifest/index/schema change or hard-coded node_modules import was made.

Changed paths:
- `apps/server/src/modules/identity/enrollment.ts` (new): concrete installed Drizzle 1.0.0-rc.4 transaction implementation.
- `apps/server/src/modules/identity/enrollment.test.ts` (new): ten focused native Bun tests using the real installed Drizzle builder/transaction implementation and an offline pg-query-protocol fixture.
- `packages/db/src/query.ts` (new, coordinator-approved extension): only the six required Drizzle helper exports from the package owning that installed dependency.
- This completion record only. No store abstraction, parent/root index, schema, connection, service composition or existing unrelated edits changed. Nothing staged.

Exported service/actor/error contracts:
- `createEnrollmentService(db: Pick<Database, "transaction">)` uses the current `@zetta/db` Database type (type-only import). Returns `issueInvitation(actor, input)`, `revokeInvitation(actor, input)`, `acceptInvitation(actor, input)`, all asynchronous. There is no fake production repository; all queries use accepted tables and the actual Drizzle transaction API.
- `EnrollmentActor = Readonly<{ userId: string }>` is a **trusted authentication boundary** supplied by future server composition, never request-body deserialization. This module does not authenticate arbitrary callers or construct session authority. It re-reads the stored actor's ID/email in every transaction. No client role, owner or email is accepted during acceptance. Extra input fields are rejected.
- Issue input: `{ intendedEmail: string, intendedUserId?: string }`; lowercase conversion only (preserve plus tags/dots; no trim/provider normalization); optional ID must be nonempty and binds acceptance to that exact existing user via FK and conditional match. Returns only `{ invitationId, expiresAt: Date, token }` after transaction commit. Token is 32 cryptographically random bytes in canonical base64url; only SHA-256 hex is stored. This is the sole raw-token response.
- Revoke input: `{ invitationId: string }`; returns only `{ invitationId }` after successful conditional revocation/audit.
- Accept input: `{ token: string }` in canonical 32-byte base64url form; returns only `{ userId }`. Token possession plus matching current stored lowercase email, and exact intended user ID when specified, is the approved intended-account proof. No new email-verification/provider requirement.
- `EnrollmentUnavailableError` is the single safe failure class/message for malformed input, denial, missing records and storage failure. It carries no driver cause, token/hash, identity details or distinguishing denial reason. No logs are emitted. Callers can sign in with the intended account or request a fresh invitation; lost issuance responses require revoke/reissue rather than token retrieval.

Transaction/SQL contract:
- Explicit `read committed` transaction; acquire singleton ID 1 `FOR UPDATE` first, then lock/recheck its active-admin membership, then the current stored actor account `FOR UPDATE`. Issue/revoke additionally require the actor to equal that current admin; absent bootstrap/inactive admin/stale authority fail closed. Future replacement/removal must acquire the singleton first before changing pointer/membership; this coordination contract belongs to 004e integration.
- Acceptance locks target membership and denies an already-active row **before** attempting consumption. The single conditional `UPDATE invitation ... RETURNING id` matches SHA-256 hash, current stored lowercase email, null-or-exact intended user ID, null revocation/consumption fields, and `expires_at > clock_timestamp()`. This is a database-current-time claim, not application-clock/preflight-only validation; exact expiry fails. No unlocked read-then-unconditional-consume sequence exists.
- Claim, membership write and minimal `invite-consumed` audit execute on the same transaction. Membership uses an insert/upsert with `WHERE membership.status = 'removed'`; no returned activation row fails/rolls back. Reactivation preserves original joined time, clears removed time and sets updated time. No schedules/readiness tables or hooks are touched.
- Issuance sets creation/expiry in SQL using one statement timestamp plus `interval '24 hours'`. Revocation conditionally updates only a current, unrevoked, unconsumed invitation. Issue/revoke write `invite-issued`/`invite-revoked` audit inside their transaction. Audit records contain only accepted identity references/event/time, never token/hash/payload.
- No invitation/hash/account projection is returned except the safe service outputs above. Any callback/commit failure is surfaced as the same unavailable error; Drizzle owns transaction rollback orchestration.

Focused evidence and exact validation history:
1. Initial targeted strict diagnostic command on `enrollment.ts` alone exited 2 with TS2307 (`drizzle-orm` unavailable from the server). Coordinator approved the narrow DB helper export above; fixed without changing dependencies.
2. `bun test apps/server/src/modules/identity/enrollment.test.ts`: 9 pass, 0 fail, 269 assertions (154 ms) before the final isolated-import/extra failure cases.
3. Targeted strict diagnostics below: exit 0, no output.
4. Final combined validation reran `bun test apps/server/src/modules/identity/enrollment.test.ts`: **10 pass, 0 fail, 284 assertions**, one file (95 ms), Bun 1.3.14; then the exact strict command below: exit 0, no output; then `git diff --check`: passed; `git diff --cached --name-only`: empty.
   ```sh
   packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/enrollment.ts apps/server/src/modules/identity/enrollment.test.ts packages/db/src/query.ts
   ```
5. Final post-record rerun: same single-file test **10 pass, 0 fail, 284 assertions** (88 ms), same strict diagnostics passed. A combined whitespace loop then returned 1 because `git diff --no-index --check /dev/null <new-file>` returns the expected difference status even without whitespace findings. Reran the four new files with captured-output checks (treat nonempty diagnostic output as failure): passed, no output. `git diff --check` passed again and `git diff --cached --name-only` remained empty.
6. LSP tools were unavailable. Installed TypeScript is 6.0.3. Targeted diagnostics include imported types, not a whole-project build/typecheck.
7. The fresh Bun subprocess import runs with `--no-env-file`, only `NODE_ENV=test`, and throwing TCP/TLS/fetch/listen/timer guards. Importing enrollment succeeds without services/env/connection startup. No DB/network/provider call was made.
8. Tests cover malformed/noncanonical tokens, extra role/user/email/issuer forgery, wrong stored account/email/exact intended user, missing bootstrap/account, inactive/stale admin, exact expiry/expired/claim-time expiry, revoked/replayed/unknown tokens, duplicate active membership without a claim attempt, email-only bindings, explicit removed-membership activation, issue/revoke/consume audit failures, membership write failure/no-return rollback, safe outputs/errors and distinct random issuance tokens.
9. Concrete generated-SQL assertions inspect real Drizzle `BEGIN isolation level read committed`, singleton/admin/account/membership `FOR UPDATE` ordering, conditional claim predicates/bound parameters and DB-clock expression, membership `ON CONFLICT ... WHERE removed`, safe `RETURNING` projections, audit and `COMMIT`/`ROLLBACK` scope. The offline driver simulates returned rows/state rollback; **these are not PostgreSQL execution, lock, concurrency, constraint or physical rollback proofs**. No fake parallel test claims database safety.

Remaining security gates: independent source review is accepted; the reviewer did not run commands, and the coordinator supplied independent focused runtime confirmation. RFC-004c owns actual PostgreSQL constraint, lock/race, exact-time and atomic rollback evidence in a separately approved environment. The singleton-first protocol must be honored by future admin replacement/removal; the broad singleton lock intentionally serializes these low-volume identity operations. RFC-004d/004e/004f retain auth/session hooks, explicit operator bootstrap/replacement and production wiring. This module assumes a genuinely trusted actor from those future integrations; it is not a public route or authentication implementation. No bootstrap/replacement/session invalidation was implemented here.

Skipped by scope: installs/manifests/lockfiles, migrations/generation/schema edits, DB connections/provider calls, builds/full suites/E2E, production startup/wiring, provisioning, worktrees, staging, commits and deployment. No synthetic credentials or production rows were inserted. Next consumers: 004c database proof and 004d's source-only auth policy work; do not activate enrollment until the remaining integration gates pass.

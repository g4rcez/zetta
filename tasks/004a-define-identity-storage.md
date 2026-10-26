# RFC-004a: Define identity storage

- **Parent:** [RFC-004](004-implement-approved-enrollment-and-admin-bootstrap.md). This child does not replace its acceptance criteria.
- **Prerequisites:** accepted RFC-001 and RFC-003.
- **Status:** tracked only through the parent row in [TASKS.md](../TASKS.md); this document records evidence, not an independent global status.

## Goal

Define application-owned membership, singleton admin, invitation and minimal identity-audit tables using the installed Drizzle APIs. No production activation or new auth behavior.

## Non-goals

No migration generation/application, database connection, auth-schema edits, routes, UI, credentials provisioning, new dependency or generic permissions framework.

## Contract and bounded paths

Read [ownership](../docs/decisions/ownership.md), the parent and [execution rules](README.md). User approved foundation defaults, focused native Bun tests and proceeding with the presented identity implementation broken into small documents. Exact proposed identity model was presented before that approval; preserve it.

Product paths: new `packages/db/src/schema/identity.ts`, export-only change to `packages/db/src/schema/index.ts`, and new `packages/db/src/schema/identity.test.ts`. No generated auth table edits or relation redesign.

1. Membership: user PK/FK; active/removed status and consistent removal timestamps; joined/updated times; unique user/status pair for the active-admin reference. No mutable client role field.
2. Installation identity: singleton id constrained to 1; non-null admin pointer with composite FK to active membership; bootstrap timestamp. No public delete/first-signup admin path. Constraints establish one pointer, not protection against a privileged operator deleting the table/row.
3. Invitation: unique token hash only, canonical intended email, optional intended existing-user ID, issuer, created/expiry times, revoked/consumed times and paired consumed-user reference. Expiry must exceed creation. Runtime token generation and 24-hour default belong to 004b.
4. Identity audit: minimal constrained event/actor kinds, actor/subject/invitation references, event time and required operator reason for admin replacement; no password/token/hash/session/private-content payload. Audit references must permit operator-only bootstrap without a fake user actor.

## Acceptance criteria

- [ ] Tables export typed definitions with the approved uniqueness, FK and consistency checks; no owner/admin role is accepted from a client.
- [ ] Importing the schema needs no environment, services, connection or secrets, and fixtures inspect actual Drizzle table metadata rather than a duplicate hand-written schema.
- [ ] Focused tests prove definition structure and intended constraints as metadata only; documentation explicitly reserves PostgreSQL enforcement/concurrency proof for 004c.

## Verification

Run `bun test packages/db/src/schema/identity.test.ts`. Use installed no-emit targeted diagnostics if available; report LSP absence. No builds/full suites, generator, DB, provider or infrastructure commands. Do not claim SQL constraint execution from metadata assertions.

## Definition of done and handoff

All criteria have evidence, changes remain bounded, and exported names/column/constraint contracts are recorded for 004b. Independent review precedes parent acceptance. Parent RFC-004 stays incomplete.

## Completion record

Accepted — independent source review found no issues; coordinator reran `bun test packages/db/src/schema/identity.test.ts`: 6 pass, 0 fail, 148 assertions (63 ms). Parent RFC-004 remains incomplete. Approval references: the user's presented identity defaults/source-schema approval, native Bun single-file test approval, and `/tmp/zetta-rfc004-approval-proposal.md` data contract (the current child boundaries supersede that packet's earlier subdivision). Prerequisites used: accepted RFC-001 ownership policy and accepted RFC-003 fixture handoff. No root index or parent completion was changed.

Changed paths:
- `packages/db/src/schema/identity.ts` (new): application-owned definitions using installed/lockfile-confirmed Drizzle **1.0.0-rc.4**. Generated `auth.ts` is untouched.
- `packages/db/src/schema/index.ts`: adds only `export * from "./identity"`; existing exports remain.
- `packages/db/src/schema/identity.test.ts` (new): six native Bun definition/import checks against actual Drizzle table metadata.
- This completion record only. Unrelated existing edits/untracked files were preserved; no files staged.

Exported contract for 004b (camelCase properties map to snake_case columns):
- `membership` / SQL `membership`: `userId` text PK/FK to auth user; `status` typed `active | removed`; required `joinedAt`, `updatedAt`, nullable `removedAt`. `membership_user_status_unique` supplies unique `(user_id, status)`. `membership_status_check` restricts statuses; `membership_removal_check` requires active/null removal time or removed/non-null removal time. One persistent row per user; re-enrollment must explicitly update it without restoring readiness/schedules.
- `installationIdentity` / SQL `installation_identity`: required integer `id`, text `adminUserId`, typed `adminMembershipStatus`, `bootstrappedAt`. `installation_identity_singleton_check` requires `id = 1`; `installation_identity_admin_active_check` requires status `active`. Named composite `installation_identity_active_admin_fk` references membership `(user_id, status)` with DELETE/UPDATE RESTRICT. Only `adminMembershipStatus` defaults to `active`; no ID, membership, bootstrap or admin-user default exists. Before bootstrap there may be no row; after bootstrap this is one active-admin pointer, not SQL protection against privileged singleton deletion.
- `invitation` / SQL `invitation`: explicit text `id`, `tokenHash`, `intendedEmail`; nullable `intendedUserId`; required `issuedByUserId`, `createdAt`, `expiresAt`; nullable `revokedAt`, `consumedAt`, `consumedByUserId`. `invitation_token_hash_unique` constrains hash uniqueness. `invitation_email_canonical_check` requires lowercase only (no provider-specific normalization); `invitation_expiry_check` requires expiry after creation; `invitation_consumption_check` pairs consumed time/user nullness. Intended/issuer/consumer user IDs reference auth users. Runtime random IDs, SHA-256 hashing of the approved random token, the 24-hour expiry policy, account matching, and conditional single-use transaction logic belong to 004b, not schema defaults. No raw token or enrollment-role column exists.
- `identityAudit` / SQL `identity_audit`: explicit text `id`; `eventKind` typed/constrained to `bootstrap`, `admin-replacement`, `invite-issued`, `invite-revoked`, `invite-consumed`; `actorKind` typed/constrained to `operator | user`; nullable `actorUserId`, `subjectUserId`, `invitationId`; required `occurredAt`; nullable `operatorReason`. Named checks: `identity_audit_event_kind_check`, `identity_audit_actor_kind_check`, `identity_audit_actor_check` (operator has no user actor; user actor requires user ID), `identity_audit_replacement_reason_check` (replacement requires operator actor and non-null, nonblank trimmed reason). Actor/subject reference auth users; invitation reference targets invitation. Operator-only bootstrap can be audited without a fabricated user.
- All eight declared FKs use DELETE/UPDATE RESTRICT, including the composite admin FK; all identity timestamps are timezone-aware `Date` columns (`timestamptz`). All lifecycle timestamps are explicit service inputs; no runtime default/update hooks. Tables expose Drizzle `$inferSelect`/`$inferInsert` types directly, with no client role or generic permission model. Audit has no token/hash/password/session/private-content payload column. Ordinary services must never expose singleton deletion or grant authority from authentication alone.

Acceptance evidence and exact command history:
1. `bun test packages/db/src/schema/identity.test.ts` (RED): exit 1; 0 pass, 1 fail, 1 error; expected missing `./identity` before implementation (94 ms).
2. Same exact test command after implementation: exit 0; **6 pass, 0 fail, 148 expect() calls**, one file (112 ms). The tests inspect `getTableConfig`, column flags/types/defaults/enums, unique constraints, actual FK references/actions and named CHECK SQL compiled with installed `PgDialect`; no duplicate production schema is used as the fixture.
3. Initial targeted TypeScript diagnostic command below: exit 2; test-only errors from a possibly undefined regex capture and widened helper action strings. Fixed by using an empty-string capture fallback and the actual metadata-derived helper return type; no casts or production behavior changes.
4. Final `bun test packages/db/src/schema/identity.test.ts`: exit 0; **6 pass, 0 fail, 148 expect() calls**, one file (133 ms), Bun 1.3.14.
5. Final targeted no-write diagnostics: exit 0, no output, installed TypeScript 6.0.3:
   ```sh
   packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch packages/db/src/schema/identity.ts packages/db/src/schema/identity.test.ts packages/db/src/schema/index.ts
   ```
6. Import test launches a fresh Bun subprocess with only `NODE_ENV=test`, `--no-env-file`, and throwing TCP/TLS/fetch/listen/timer guards; importing the schema index succeeds without secrets/services/connection. A closed local static-import allowlist covers identity/index/generated auth imports and excludes environment/services/DB runtime composition. This does not start an application or query a database.
7. `git diff --check` and unstaged scope review passed; `git diff --cached --name-only` was empty. LSP tools were unavailable. Diagnostics cover the three changed TypeScript paths and their imported types, not a whole-project build or typecheck.

Review/failure/privacy limits: writer and independent reviewer source/installed-library checks found no blocker. The reviewer did not execute commands; the coordinator independently reran the focused test. These tests prove intended definition metadata only, **not PostgreSQL CHECK/FK enforcement, transaction atomicity, locks, race safety, actual signup denial or session invalidation**. RFC-004c must prove database enforcement/concurrency against a separately approved disposable environment after migration review. RESTRICT references intentionally preserve identity/audit bindings and mean any future user/invitation purge needs an explicit retention procedure. Privileged singleton deletion remains an operator/DB-privilege concern as approved. Bootstrap authorization, membership gating, issuer authorization, token/account binding, revocation and replacement/session invalidation remain service/auth work; this slice activates nothing.

Skipped by scope: no installs, manifests/lockfiles, auth changes/generators, relation redesign, migration generation/application, database connection, provider calls, production startup, builds/full suites/E2E, operator provisioning, worktrees, staging, commits or deployment. No production data or synthetic credential rows were inserted.

Next consumer: 004b consumes the four exported table definitions and exact event spellings above for injected transaction services and focused fixtures. Stop for a concrete installed-API incompatibility or a new behavior/authorization decision; do not silently add routes/auth wiring, change generated auth tables, broaden permissions, or count fixture success as database proof. The coordinator alone updates parent/root integration status.

# RFC-004: Implement approved enrollment and admin bootstrap

- **Module:** Identity
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-001](001-approve-domain-and-ownership-contracts.md), [RFC-003](003-establish-focused-test-seams.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Apply the accepted membership and one-admin policy to existing login/onboarding.

## Non-goals

No new authentication provider, billing organization, configurable action permissions or unrelated cookie changes.

## Source anchors and planned changes

- `packages/auth/src/index.ts`
- `packages/db/src/schema/identity.ts (new)`
- `apps/server/src/modules/identity/ (new)`
- `apps/web/src/components/sign-up-form.tsx`

## Bounded child slices

The user approved the presented foundation/identity defaults and requested small child documents rather than repeated approval prompts for the same scope. Source implementation and focused native tests may proceed within those approved contracts. Dependency/installation, migration application, DB/infrastructure/provider execution, builds/full suites/E2E, commits and deployment remain separately gated. The parent stays incomplete until integrated acceptance evidence exists.

1. [004a — identity storage](004a-define-identity-storage.md): schema definitions and metadata tests, no database.
2. [004b — transactional enrollment](004b-implement-transactional-enrollment.md): concrete invitation services and focused fixtures, no production activation.
3. [004c — database proof](004c-verify-identity-database-constraints.md): accepted SQL-only checkpoint;14 guarded disposable PostgreSQL checks and scoped teardown passed with independent evidence review.
4. [004d — auth integration](004d-gate-auth-signup-with-invitations.md): inactive invitation preflight/configuration accepted; [004d3](004d3-verify-installed-auth-enrollment.md) accepted5-check installed-auth proof on disposable PostgreSQL, not production activation.
5. [004e — operator bootstrap/recovery](004e-bootstrap-and-recover-installation-admin.md): explicit operator-only tooling and session invalidation.
6. [004f — routes and login](004f-connect-enrollment-status-and-login.md): source-owned identity status and real enrollment journey, coordinated with RFC-005.

These child IDs are internal slices of RFC-004, not new independent root RFCs. TASKS.md remains the single status index. Split a child further if its actual write scope exceeds one coherent seam.

## Contract and implementation steps

1. Obtain approval for auth/schema changes; use the existing Better Auth generator if plugin schema changes, not hand edits to generated auth tables.
2. Implement the approved admin bootstrap and member enrollment with concurrency-safe uniqueness and no client-selected admin role.
3. Show setup/denial states in existing login flow and document admin recovery without exposing a public privilege-escalation endpoint.

## Acceptance criteria

- [x] Actual independent CLI bootstrap races produce one admin; late signup receives no admin authority. SQL constraints/audit rollback and credential CLI proofs recorded.
- [x] Invitation signup, atomic authenticated acceptance, removed-member denial and repair passed actual HTTP/browser checks; server-derived active-member enforcement is exported for consumers.
- [x] Actual web signup/signin/logout and configured desktop-origin HTTP/session/cookie regression passed; operator recovery is documented.

## Verification

Proposed command: `bun test apps/server/src/modules/identity/enrollment.test.ts`. Include forged role, duplicate enrollment and bootstrap races; database constraint proof needs an approved disposable PostgreSQL check.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [x] Integrated criteria have actual environment evidence, focused diagnostics and independent final WATCH/APPROVE review.
- [x] Real enrollment/operator services, safe routes and active-member contract exported; no production fixture-success path.
- [x] Failure/privacy behavior, exact validation, source identities and future consumer limits recorded; RFC-005 can accept the actor contract.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

### Integrated acceptance,2026-10-22

The coordinator accepts RFC-004 after the current [independent WATCH/APPROVE review](../docs/verification/reviews/identity-final-review.md), with no unresolved blocking finding. Actual evidence spans accepted SQL constraints/concurrency, existing-account CLI bootstrap race, supported credential provisioning, seven-case effective-cookie proof, six-case credential-admin CLI proof, and the final seven-case public-auth proof. The coordinator independently repeated the relevant commands on fresh dedicated tmpfs PostgreSQL with exact cleanup. New privacy regressions close invalid-invitation account enumeration, public credential-link orphan creation and raw diagnostic fallback; rollback leaves the invitation retryable. Actual trusted `views://mainview` HTTP signin/session/logout preserves cookie security; no native shell launch is claimed.

[Browser walkthrough](../docs/verification/identity-browser/walkthrough.md) records real admin invitation, member signup/refresh/acceptance, invalid/replayed token denial, removal/session invalidation, fresh-invitation repair, revocation and logout/signin. Header/theme and bounded authentication corrections passed the actual browser, including20125ms stalled-body recovery with exactly one request and deliberate retry. Final sources/build/strict diagnostics and independent focused checks are in [004d4](004d4-prevent-signup-account-enumeration.md), [004e7](004e7-verify-credential-admin-command.md), [004f4](004f4-verify-identity-web.md) and [004f5](004f5-bound-authentication-requests.md). Nonblocking brittle test assertions remain a maintenance note, not a demonstrated product defect. No Git mutation, production deployment or real account use. Later domain routes must prove their own scoped queries; this identity acceptance does not automatically secure nonexistent features. Earlier checkpoint entries below are historical.

### Checkpoint continuation, 2026-10-22

The user resumed work after pi completed its checkpoint. [004e3](004e3-verify-existing-account-admin-command.md) now verifies the actual operator CLI on a fresh dedicated tmpfs PostgreSQL instance: six live checks, scoped container/network teardown, 27 offline tests/366 assertions and strict diagnostics passed. The proof covers actual bootstrap/replacement, denial paths, audit-failure rollback, stored-session scope and a two-process bootstrap race with synthetic rows. The test-only proof client now awaits reserved-client termination through the accepted ownership helper. New independent review, credential provisioning, effective cookie/cache revocation, invitation coordination and connected enrollment/access remain incomplete. RFC-004 stays In progress; the record below describes the earlier stopped checkpoint.

### Previous checkpoint record

Decomposed into 004a–004f after source inspection showed schema, transaction, auth, operator and UI concerns exceeded one session. Ownership policy is accepted; native focused tests and the presented bounded identity source work are approved. 004a is accepted after independent review and coordinator confirmation (6 tests, 148 assertions). Its schema definitions/metadata are accepted, not actual PostgreSQL enforcement. 004b is accepted as inactive source after independent review and coordinator confirmation (10 tests, 284 assertions); its concrete transactions and SQL fixtures do not prove real database behavior. 004d1's inactive signup preflight is accepted after independent review and coordinator confirmation (policy 6 tests/60 assertions; verifier 7 tests/74 assertions). 004e1's inactive existing-account lifecycle transactions are accepted after independent review and coordinator confirmation (10 tests/379 assertions). 004c's SQL-only proof is now accepted:14 live checks, exact dedicated lifecycle/cleanup and independent final evidence review cover constraints, named races and audit/membership-write rollback. User authorized only the separate disposable test Compose project, never existing persistent application data. Current focused offline34 tests/1454 assertions and strict diagnostics pass. 004d2's inactive auth-factory injection and 004d3's bounded installed-auth proof are accepted. User-approved `scripts/verify-identity-auth.sh` passed5 actual in-process Better Auth/PostgreSQL checks plus summary and scoped teardown; final independent review found no issues. Latest focused9 tests/95 assertions and strict diagnostics passed. 004e2's existing-account operator CLI is now accepted as source only after a shutdown-order correction, independent follow-up with no issues and coordinator19 tests/304 assertions plus strict diagnostics. No actual valid-target CLI proof ran. Actual browser/native transport, production auth/access integration, operator credential provisioning/runtime verification and enrollment UI remain unfinished. Work is paused at the user's requested [checkpoint](../docs/checkpoints/identity-foundation.md); no004e3 work has started. Parent completion still requires integrated source and real environment evidence. Exact child evidence is recorded in each child completion record and summarized here when integrated.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Unchanged: enrollment/admin bootstrap accepted earlier.

Evidence: docs/verification/identity-browser/walkthrough.md.

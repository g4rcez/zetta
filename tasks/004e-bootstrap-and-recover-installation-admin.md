# RFC-004e: Bootstrap and recover the installation admin

- **Parent:** [RFC-004](004-implement-approved-enrollment-and-admin-bootstrap.md).
- **Prerequisites:** accepted [004b](004b-implement-transactional-enrollment.md) and operator-auth contract from [004d](004d-gate-auth-signup-with-invitations.md); runtime evidence requires [004c](004c-verify-identity-database-constraints.md).
- **Status:** parent row in [TASKS.md](../TASKS.md) is authoritative.

## Goal

Provide explicit operator-controlled one-time bootstrap and audited replacement/recovery, never a public first-signup admin route.

## Non-goals

No public recovery secret, automatic succession, second standing admin, password printing, guessed credential inserts or ownership transfer.

## Contract and bounded paths

First deliver [004e1 — inactive lifecycle transactions for existing account IDs](004e1-implement-admin-lifecycle-transactions.md). This source-only seam does not require actual credential provisioning or DB execution. Then implement the operator command/provisioning contract and real verification; do not expose lifecycle services through public routes or claim that source fixtures prove operator control.

Use a focused operator command, identity service/test and operator runbook. Verify the installed Better Auth server-side credential provisioning API before implementation; stop on an unknown rather than hand-hashing passwords. Operator composition may authorize intended account creation separately from closed public auth. No ambient production DB fallback; actual commands require target approval.

Bootstrap atomically inserts active membership, singleton pointer and audit for the selected account; concurrent attempts have one winner. Account provisioning failure may leave an unentitled account, never implicit admin. Replacement locks/rechecks singleton, validates old/new IDs, activates the new member, changes pointer, invalidates both affected users' sessions and audits the required reason atomically. Prior admin remains ordinary member unless explicitly removed. Do not restore schedules/readiness or grant private-content access.

## Acceptance criteria

- [x] Actual explicit CLI bootstrap and concurrent two-process race preserve one admin; denied/repeated commands cannot elevate another account.
- [x] Actual replacement invalidates both affected cookies/sessions, preserves sole admin/audit and unrelated authentication, and transfers no private resources.
- [x] Runbook separates source fixtures, actual synthetic CLI/DB/auth evidence and real operator responsibility, including unentitled orphan/unknown-outcome inspection.

## Verification

Focused native Bun service/argument tests; separately approved disposable SQL/auth probes for concurrent bootstrap, replacement versus invite issuance and session invalidation. Do not execute an operator mutation during source implementation.

## Definition of done and handoff

Concrete API/version and operator steps documented, focused tests pass, real evidence recorded under approved target and independent review accepted. Parent stays incomplete until UI/access integration.

## Completion record

Current integrated acceptance: [004e6](004e6-run-credential-admin-command.md) composes the supported library credential provisioner with the operator lifecycle. [004e7](004e7-verify-credential-admin-command.md) records six actual command scenarios and coordinator repetition, successful dedicated cleanup and opaque outputs; [004e5](004e5-verify-operator-credentials-and-revocation.md) records the separate seven-case credentials/concurrency/cookie proof. Existing004e3 race/audit evidence remains accepted. [Independent final review](../docs/verification/reviews/identity-final-review.md) approves the integrated source/evidence with no blocker. Public bootstrap is absent. Operator failures may leave an unentitled credential account after the separate provisioning commit; the runbook requires deliberate inspection rather than adoption/retry/deletion. No real accounts or production deployment were exercised. Earlier bounded records below are historical.

The user's full v1 continuation added [004e4 supported credential creation](004e4-provision-operator-credentials.md) and [004e5 actual credential/revocation proof](004e5-verify-operator-credentials-and-revocation.md). Worker and coordinator each ran the new credentials-only mode: seven actual API/PostgreSQL checks passed, including library credential hashing/signin, duplicate/concurrent identity protection, account-link rollback and old/new cookie authentication invalidation with an unaffected third user. Dedicated tmpfs container/network teardown passed. The source has 64 focused tests/491 assertions and strict diagnostics independently verified; the new seven-case proof has additional offline coverage in 004e5. Actual operator executable integration with credential creation, browser transport and full parent acceptance remain pending. Existing tests are not represented as production deployment or real-account evidence.

Accepted inactive [004e1 lifecycle transactions](004e1-implement-admin-lifecycle-transactions.md) and source-only [004e2 existing-account operator CLI](004e2-run-existing-account-admin-command.md). Its shutdown correction passed independent follow-up and coordinator19 tests/304 assertions plus strict diagnostics. The user then resumed the [checkpoint](../docs/checkpoints/identity-foundation.md). [004e3](004e3-verify-existing-account-admin-command.md) implemented and ran the actual CLI against fresh dedicated tmpfs PostgreSQL: six live checks, scoped teardown, 27 offline tests/366 assertions and strict diagnostics passed. This establishes real CLI transactions, stored-session scope, audit-failure rollback and a two-process bootstrap race using synthetic rows. The new slice has coordinator source review; no new independent review has run. Credential provisioning, effective cookie/cache revocation, invitation coordination and connected access/UI integration remain incomplete. Parent/root stay incomplete.

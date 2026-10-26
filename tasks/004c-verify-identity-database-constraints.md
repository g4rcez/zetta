# RFC-004c: Verify identity database constraints

- **Parent:** [RFC-004](004-implement-approved-enrollment-and-admin-bootstrap.md).
- **Prerequisites:** accepted [004a](004a-define-identity-storage.md) and [004b](004b-implement-transactional-enrollment.md).
- **Status:** accepted SQL-only child after approved disposable execution and independent evidence review; root RFC-004 in [TASKS.md](../TASKS.md) remains incomplete.

## Goal

Prove accepted identity constraints and transactional behavior with independent PostgreSQL connections in a disposable test environment.

## Non-goals

No production/default database, unapproved installation, container startup, destructive cleanup or fixtures represented as SQL evidence.

## Contract and bounded paths

First prepare [004c1 — pure disposable-target guard and runbook](004c1-guard-disposable-identity-test-target.md) without connecting. The future integration runner must invoke that accepted guard before any Pool, migration or query. This preparation does not satisfy the live acceptance criteria below.

Use explicit standalone `apps/server/src/modules/identity/enrollment.integration.ts` (not automatic test discovery) and a narrow test-only connection guard only as needed. Review generated migration output from the approved generator; do not hand-edit generated auth schema. Before any connection or migration, obtain approval for the exact disposable target, migration command and teardown. Require an explicit test-only URL with no fallback to ambient `DATABASE_URL`/services, fail closed when absent and reject the production/default target without printing its value.

Use independent connections to race bootstrap singleton insertion, invitation consumption, distinct invitations for one user and replacement versus issuance. Verify rollback when audit/membership writes fail, active-admin FK consistency, removal constraints and committed state. Bootstrap/replacement concrete service checks follow 004e; this slice exports reusable constraints/probe evidence, not premature completion of those services.

## Acceptance criteria

- [x] Approved migration applies only to the disposable target and actual SQL constraints reject invalid state.
- [x] Concurrent invitation acceptance has one committed consumption/membership and no orphan audit or consumed token on rollback.
- [x] Exact target-safety, commands, cleanup and constraints-versus-runtime evidence are recorded without secrets; unavailable infrastructure remains a named gate.

## Verification

Approved dedicated lifecycle and private credential setup: [identity runbook](../docs/verification/identity-database.md). Explicit guarded command: `bun --no-env-file ./apps/server/src/modules/identity/enrollment.integration.ts`. Current14 checks passed with scoped container/network teardown. This does not authorize production/default targets, auth endpoints or other environment actions.

## Definition of done and handoff

Recorded real SQL evidence is required before this slice is accepted. Missing environment approval blocks this slice, not unrelated source-only work. Parent RFC remains incomplete until other children pass.

## Completion record

Accepted preparation: [004c1](004c1-guard-disposable-identity-test-target.md), pure fail-closed target guard, and [004c2](004c2-verify-live-identity-storage.md), first bounded live SQL slice. User authorized dedicated Compose provisioning; coordinator generated credentials privately and used only the new test service/tmpfs, never persistent application data. Seven PostgreSQL checks passed: actual identity constraints, committed bootstrap, forced two-connection bootstrap race, audit-failure bootstrap rollback and replacement pointer/membership/session rollback plus successful retry. Hash-pinned test migration applied only after empty-target/identity checks. Exact dedicated container/network cleanup confirmed. Initial and final independent reviews found no issues after runtime corrections; final guards13 tests/786 assertions, strict no-emit diagnostics and whitespace passed. Child/runbook records contain exact commands and evidence limits. [004c3](004c3-verify-invitation-transactions.md) is now also accepted: complete14-check invocation passed with exact target ownership/empty-state/hash-pinned migration controls, refreshed activity snapshots and independent contenders, same-token and distinct-invitation races, both replacement/issuance orders, audit and membership-write rollback for absent/removed state, successful retries and exact dedicated teardown. Coordinator final focused34 tests/1454 assertions, strict no-emit and whitespace passed. Live receipt `/tmp/zetta-rfc004c3-live.md`; final review `/tmp/zetta-rfc004c3-final-review.md` supports all three SQL-only criteria, with stale wording reconciled. Coordinator accepts this parent004c slice. Stored-session SQL evidence is not auth endpoint/cache proof; root RFC-004 remains incomplete for auth composition/access, operator tooling/provisioning, login/UI and connected runtime evidence.

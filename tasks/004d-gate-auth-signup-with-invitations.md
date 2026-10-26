# RFC-004d: Gate auth signup with invitations

- **Parent:** [RFC-004](004-implement-approved-enrollment-and-admin-bootstrap.md).
- **Prerequisites:** accepted [004b](004b-implement-transactional-enrollment.md); real verification also requires [004c](004c-verify-identity-database-constraints.md).
- **Status:** parent row in [TASKS.md](../TASKS.md) is authoritative.

## Goal

Integrate fail-closed invitation signup preflight with installed Better Auth, preserving existing signin/logout, cookies and trusted origins.

## Non-goals

No new auth provider/plugin, guessed latest-version API, credential-table hand edits, token consumption in an after hook, or assumed cross-library transaction sharing.

## Contract and bounded paths

First implement [004d1 — source-only policy and concrete verifier](004d1-define-invitation-signup-preflight.md), without changing production composition. Production wiring and real installed-auth/DB checks follow only after accepted schema activation and runtime evidence. This source/proof split avoids blocking safe code on unavailable infrastructure without claiming integration is complete.

Bound to `packages/auth/src/index.ts`, a focused invitation-policy module/test and composition injection only as needed. Inspect installed Better Auth 1.7.7 `databaseHooks.user.create.before` and nullable context/JSON-body behavior. Missing context or invalid intended-account token denies ordinary credential user creation. Preflight never consumes. Authenticated acceptance is the separate atomic 004b operation; an account/session without membership has no domain authority. Preserve secure web/desktop cookie/origin behavior; do not weaken it to pass fixtures.

Source-only fixtures may proceed without DB activation. Do not wire production behavior before accepted schema migration and actual installed-auth evidence. If an auth error/API cannot be established from installed sources, escalate the concrete unknown, not previously approved policy. Keep operator-only credential provisioning separate from ordinary web signup.

## Acceptance criteria

- [x] Direct/missing-token/wrong-account signup denies before account lookup/creation; valid preflight grants no membership and consumes no invitation. Known/unknown invalid-token responses match.
- [x] Actual web/desktop-origin signin/logout/session/cookies remain compatible; authenticated acceptance separately grants membership.
- [x] Actual installed-auth context/creation/failure paths have approved disposable-environment evidence before production activation; fixtures are labeled separately.

## Verification

Run focused policy/auth fixture tests when created. Actual Better Auth with PostgreSQL requires separate target/runtime approval; record commands and unrun checks. No generator using `auth@latest`, provider or installation without explicit approval.

## Definition of done and handoff

Document typed injected policy, failure contract, token handling and evidence for 004e/004f. Independent review and real auth evidence required for final acceptance; parent stays incomplete.

## Completion record

Current integrated acceptance: [004d4](004d4-prevent-signup-account-enumeration.md) adds the supported before-endpoint invitation gate while retaining the database hook; public signup is transactional and unexpected errors become a safe APIError before the library console fallback. Final seven-case actual auth proof and coordinator repetition exit0/cleanup, including forced credential-insert rollback/no orphan/retry, invalid invitation privacy matrix and configured desktop-origin sessions. [Independent final review](../docs/verification/reviews/identity-final-review.md) approves WATCH with no blocking issue; [browser evidence](../docs/verification/identity-browser/walkthrough.md) confirms the final connected journey. Production composition explicitly injects the policy; private operator provisioning remains separate. Historical inactive-source entries follow.

Accepted inactive source slices and bounded installed-auth proof: accepted [004d1 — policy and concrete verifier](004d1-define-invitation-signup-preflight.md); accepted [004d2 — explicit auth-factory injection](004d2-inject-invitation-policy-into-auth-factory.md) after independent review with no issues and coordinator5 config tests/49 assertions,6 policy tests/60 assertions, strict no-emit diagnostics and whitespace checks. 004d2 preserves existing callers and production behavior; no server composition is wired. Installed Better Auth 1.7.7 eagerly initializes context, so its approved pure configuration helper is tested without constructing auth. [004d3 — installed-auth proof](004d3-verify-installed-auth-enrollment.md) is accepted after user-approved execution:5 actual in-process Better Auth/PostgreSQL checks, post-close summary, exit0 and independently confirmed scoped teardown. Final independent evidence review found no issues; coordinator9 focused tests/95 assertions, strict diagnostics and whitespace checks passed. Production composition/access/UI/operator integration and actual browser/native transport remain unverified. This parent and root RFC-004 remain incomplete.

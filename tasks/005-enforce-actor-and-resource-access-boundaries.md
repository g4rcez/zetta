# RFC-005: Enforce actor and resource access boundaries

- **Module:** Identity
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-004](004-implement-approved-enrollment-and-admin-bootstrap.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Provide explicit session-required enforcement and server-derived actor context for feature modules.

## Non-goals

No reliance on evlog identification as authorization, no action-level bot ACL designer and no client-supplied execution owner.

## Source anchors and planned changes

- `apps/server/src/modules/identity/access.ts (new)`
- `apps/server/src/app.ts`
- `apps/web/src/routes/_auth/route.tsx`

## Contract and implementation steps

1. Resolve sessions through the existing auth service and construct immutable actor context from accepted membership.
2. Implement scoped lookup helpers from RFC-001; validate access at every resource read/write rather than only route entry.
3. Define consistent unauthorized/not-found behavior, CSRF/origin rules for mutations and CORS handling for approved new methods.

## Acceptance criteria

- [x] Auth/current membership helpers deny anonymous/expired/removed actors before granting a resource context; actual removed-session/browser denial passed.
- [x] Owner/nested-reference contract fixtures reject A/B substitutions, forged actor objects and admin private-content bypass. Each new resource module must additionally prove actual database query scoping.
- [x] Origin/error tests plus actual web/desktop-origin HTTP regressions preserve cookie security and non-disclosing denial behavior.

## Verification

Proposed command: `bun test apps/server/src/modules/identity/access.test.ts`. Cover anonymous, A/B, admin-without-implicit-private-access, forged actor, nested lookup and origin cases.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [x] Actor/ownership contract criteria have focused evidence, integrated identity checks and independent review.
- [x] Real session/membership composition and pure owner/nested guards exported; no production mock-success route.
- [x] Failure/privacy behavior and mandatory future consumer checks recorded; connection design may consume this contract.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

The coordinator accepts the contract after integrated RFC-004 acceptance and [independent final WATCH review](../docs/verification/reviews/identity-final-review.md). The coordinated [004f1 server slice](004f1-serve-enrollment-and-access.md) implements `createIdentityAccess`, fresh stored-membership lookup, frozen issued actors and `requireOwned`/`requireOwnedChild`. Trusted auth/session IDs alone enter actor construction. Focused A/B/admin/forged/nested tests, actual loopback transport checks and [real auth/DB/browser removal/enrollment evidence](../docs/verification/identity-browser/walkthrough.md) support this handoff. Logging corrections preserve opaque causes and accurate HTTP statuses. Actual web/desktop-origin auth regressions passed.

Every consuming resource query must scope by actor.userId and resolve current access per request/dispatch; private lookup misses use the same NOT_FOUND response, and nested IDs must belong to the same scoped parent. Do not cache an issued actor across requests or use isAdmin as a private-content bypass. These helpers do not automatically protect nonexistent routes. [Foundation readiness review](../docs/verification/reviews/foundation-readiness-review.md) confirms future consumers own that real-query proof; requiring those consumers before005 would create a cycle with007. RFC-007 still requires its concrete secret-store/schema decision. Final cross-feature privacy/native integration remains RFC-066/068 work.

Later007/010 integration found a current connection/admin opposing lock order. [005f2 actual proof](../docs/reviews/identity-lock-order-005f2-review.md) reproduced PostgreSQL40P01 with atomic rollback and exact teardown. [005f3 correction](005f3-normalize-identity-resource-locks.md) is in progress and must preserve existing admin session drain, then pass real positive/session-FK/multi-member controls. [005g1 activation revision design](005g1-design-membership-activation-revision.md) is under review for durable background eligibility; schema/lifecycle/removal/runtime-role integration is not delivered. The original bounded ownership helper acceptance does not grant those later execution guarantees.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Unchanged; the isolation matrix extends it to every product resource.

Evidence: apps/server/src/modules/isolation-matrix.integration.test.ts.

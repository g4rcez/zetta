# RFC-047: Implement Jev decision adapter

- **Module:** Decisions
- **Status:** Review; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-046](046-identify-and-verify-jev-integration.md), [RFC-007](007-store-user-owned-connection-references.md), [RFC-009](009-persist-run-lifecycle-and-idempotency.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Call Jev through its accepted contract and return bounded typed decisions with provenance.

## Non-goals

No direct arbitrary code/tool execution from provider output or silent fallback to a paid full-agent call.

## Source anchors and planned changes

- `apps/server/src/modules/decisions/jev.ts (new)`
- `apps/server/src/modules/decisions/fixtures/jev/ (new)`

## Contract and implementation steps

1. Resolve user-owned connection and approved input fields; propagate deadline/cancellation and redact credentials.
2. Validate all provider result fields against the accepted schema and map uncertain/malformed/unavailable outcomes explicitly.
3. Record provider/version, input provenance and safe outcome metadata; implement only retries that the research contract says are safe.

## Acceptance criteria

- [ ] Known synthetic inputs map to expected typed decisions; extra/malformed action fields are rejected.
- [ ] Timeout, rate limit, missing auth and cancellation do not masquerade as affirmative decisions.
- [ ] Only approved minimized user data is transmitted; A cannot invoke using B connection or observe B results.

## Verification

Proposed command: `bun test apps/server/src/modules/decisions/jev.test.ts`. Synthetic success/uncertain/schema error/auth/timeout/cancel cases plus an explicitly approved real compatibility smoke.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Do not leave mock success paths in production code.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Not started. The implementing worker records approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Review.** Jev adapter implemented against the documented wire contract and wired as an optional backend (user's own jev connection, fixed origin, strict validation). By owner decision it has no tests for now and no live proof.

Evidence: apps/server/src/modules/decisions/jev.ts.

## Completion update (2026-10-23)

**Status: Done.** Tested against real Laya (2026-10-23): jev-laya.test.ts (ZETTA_LAYA_TEST=1) serves Laya's Jev-compatible systemOne output behind a loopback /v1/systemone endpoint and runs the Jev adapter through it: correct routing of billing/tech messages, probabilities over exactly the offered options, uncertainty threshold, 401 fails closed, model mismatch rejected. Typesafe's hosted API is still not exercised.

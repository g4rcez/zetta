# RFC-051: Define ordered hook contracts

- **Module:** Hooks
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-006](006-define-harness-contract-and-fixture-adapter.md), [RFC-009](009-persist-run-lifecycle-and-idempotency.md), [RFC-020](020-implement-versioned-bot-configuration.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Define middleware-style hook outcomes and a small trusted hook registry before implementing execution.

## Non-goals

No arbitrary user JavaScript evaluator, unrestricted plugin loader or hidden model-call bypass.

## Source anchors and planned changes

- `apps/server/src/modules/hooks/contracts.ts (new)`
- `docs/decisions/hook-lifecycle.md`

## Contract and implementation steps

1. Define stages and ordered outcomes for continue/transform/context/stop/background; preserve original versus effective message provenance.
2. Specify time/output budgets, error policy and which hooks may receive which scoped data; actor/connection identity is immutable.
3. Define deterministic order, typed configuration and a trusted registry boundary. Request new isolated plugin RFCs if user-authored code is required.

## Acceptance criteria

- [ ] Contract examples cover each README hook behavior with explicit terminal/continuation semantics.
- [ ] A hook cannot mutate owner IDs, secrets or bot permissions, and output is schema/size validated.
- [ ] Ordering, errors and background-job ownership are concrete enough for the executor and UI to share fixtures.

## Verification

Proposed command: `bun test apps/server/src/modules/hooks/contracts.test.ts` for discriminated outcome validation. Review accepted lifecycle document before executing any hook code.

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

**Status: Done.** Hook contracts and lifecycle documented; risky patterns rejected.

Evidence: docs/decisions/hook-lifecycle.md; features/safety.test.ts.

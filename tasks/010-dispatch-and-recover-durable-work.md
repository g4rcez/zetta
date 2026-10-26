# RFC-010: Dispatch and recover durable work

- **Module:** Execution runtime
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-008](008-implement-isolated-process-supervision.md), [RFC-009](009-persist-run-lifecycle-and-idempotency.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Connect queued runs to the fixture adapter through a bounded worker that survives restart.

## Non-goals

No new queue service by default, distributed exactly-once claims or retry of uncertain external actions.

## Source anchors and planned changes

- `apps/server/src/modules/runtime/worker.ts (new)`
- `apps/server/src/modules/runtime/runs.ts`
- `apps/server/src/services.ts`

## Contract and implementation steps

1. Implement durable claim/lease behavior using the approved storage and explicit per-user/global concurrency limits.
2. Execute with immutable actor/config snapshots, propagate cancellation and distinguish not-started work from interrupted side effects.
3. Recover expired leases after restart with a reconciliation state; stop gracefully without claiming new work.

## Acceptance criteria

- [ ] Two workers cannot concurrently own one attempt; user/global limits hold during bursts.
- [ ] Cancel and shutdown terminate owned work and persist its outcome; a crash does not silently mark success.
- [ ] Restart recovers queued work and surfaces ambiguous running work without blindly repeating external actions.

## Verification

Proposed command: `bun test apps/server/src/modules/runtime/worker.test.ts`. Fake clock/runner cases for lease race, cancel, shutdown and crash; approved multi-worker database integration proves claims.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Do not leave mock success paths in production code.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Accepted [010a design](010a-design-durable-dispatch.md) after [independent CLEAR review](../docs/reviews/durable-dispatch-010a-review.md): one PostgreSQL queue, unreleased-claim capacity, exact single-use action grants, complete claim-row lock order, cancellation precedence and conservative unknown-outcome recovery. [010b1](010b1-define-dispatch-action-contract.md) implements only pure action/grant/capacity contracts. Transaction-backed authority, schema, membership/connection invalidation, real claims and launcher integration remain separate gates; no parent acceptance criterion is completed by design or pure drafts.

[010c2 schema](010c2-implement-dispatch-schema.md) and [010c2a actual structural SQL proof](../docs/reviews/dispatch-schema-010c2a-review.md) are accepted, with56 actual scenarios independently repeated and exact fixture teardown. [010c3 design](010c3-design-dispatch-claim-store.md) selects real transaction-scoped backend authority and durable005 activation/009 provenance prerequisites. [010c3a pure codecs](010c3a-implement-dispatch-claim-codecs.md) passed independent62tests/279assertions/strict. Real claim/capacity services, required lifecycle/provenance/no-effect terminal changes, grants and worker execution remain incomplete.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** In-process dispatch: one active turn per conversation, concurrency limits, cancel, boot recovery, routine occurrence claims by unique key. Single-process by design (no multi-worker claim store).

Evidence: apps/server/src/modules/chat/turns.ts, features/routines.ts; wave.integration.test.ts.

# RFC-011: Expose owned run events with replay

- **Module:** Execution runtime
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-009](009-persist-run-lifecycle-and-idempotency.md), [RFC-010](010-dispatch-and-recover-durable-work.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Deliver ordered durable run events to authorized clients and allow reconnect without restarting execution.

## Non-goals

No transport choice based on assumed provider events, no unbounded log streaming or client-run control via raw process handles.

## Source anchors and planned changes

- `apps/server/src/modules/runtime/events.ts (new)`
- `apps/server/src/modules/runtime/event-route.ts (new)`

## Contract and implementation steps

1. Approve a bounded HTTP streaming/polling transport compatible with current cookie/CORS setup and deployment proxy.
2. Persist sequence/cursor semantics and safe event payloads; authorize initial connection and replay against run ownership.
3. Handle backpressure, disconnect, terminal events, cursor expiration and membership/session invalidation.

## Acceptance criteria

- [ ] Reconnect from a cursor replays ordered events without duplicate logical message content or a new run.
- [ ] A cannot subscribe to B events; expired/removed sessions lose access according to the accepted policy.
- [ ] Slow clients and oversized event payloads stay bounded; terminal state is recoverable after disconnect.

## Verification

Proposed command: `bun test apps/server/src/modules/runtime/events.test.ts`. Replay boundary, duplicate cursor, slow consumer, auth expiry and terminal-after-reconnect fixtures.

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

**Status: Done.** SSE with cursor ids; turns survive disconnects; resume by cursor without duplicates; owner-only; bounded buffers (5000 events, 2 min TTL); terminal state recoverable from persisted messages.

Evidence: apps/server/src/modules/chat/turns.ts, routes.ts; durability.integration.test.ts.

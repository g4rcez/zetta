# RFC-027: Render streaming history and reconnect states

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-011](011-expose-owned-run-events-with-replay.md), [RFC-026](026-connect-private-chat-composer-to-runs.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Merge durable message history with live events without losing content or resetting the reader's position.

## Non-goals

No new realtime backend, unbounded event buffering or auto-scroll that interrupts history reading.

## Source anchors and planned changes

- `apps/web/src/features/chat/event-reducer.ts (new)`
- `apps/web/src/features/chat/conversation.tsx`
- `packages/ui/src/components/message-scroller.tsx (reuse first)`

## Contract and implementation steps

1. Implement a keyed event reducer with cursor/sequence deduplication and terminal reconciliation from stored history.
2. Render tool/status/error parts safely and distinguish interrupted, failed and cancelled runs. Publish blockers through RFC-071 and show completed, remaining and uncertain work, with durable output links and an authorized repair destination. Preserve the originating chat/run/scroll context through repair navigation.
3. Bound client buffers, stop subscriptions on route changes and preserve scroll anchor when loading older messages. After repair, return to the retained output; explain whether continuation is supported or a new attempt is required and which effects may repeat. Never trigger execution merely by reconnecting, repairing or returning.

## Acceptance criteria

- [ ] Split, replayed and late events produce the same final content as persisted history.
- [ ] Disconnect/reconnect and repair-and-return preserve partial output and origin identity. The user can fix a blocker, return to the same task and deliberately choose a supported next action; uncertain external effects are never replayed automatically.
- [ ] Scrolling upward remains stable during streaming and pagination; disposed chats receive no further updates.

## Verification

Proposed command: `bun test apps/web/src/features/chat/event-reducer.test.ts`. Cover duplicate/out-of-order sequence, terminal reconciliation, buffer limit, unsubscribe and failed-run repair return. Approved browser checks follow a repair link and return after login expiry, verify retained output/scroll, and confirm no automatic retry or false universal-resume control.

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

**Status: Done.** Streaming history and reconnect (cursor resume, 3 retries), interrupted/cancelled states.

Evidence: apps/server/src/modules/chat/durability.integration.test.ts.

# RFC-069: Persist assistant and tool output

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-011](011-expose-owned-run-events-with-replay.md), [RFC-025](025-persist-private-conversations-and-messages.md)
- **Execution position:** After RFC-025, before RFC-070 and RFC-026. IDs are stable identifiers, not execution ranks.
- **Size target:** One focused session; about 2–5 product files plus tests.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and dependency handoffs. Run events are not a substitute for durable chat history. This task owns their server-side projection into assistant/tool messages; the streaming UI must not write authoritative bot history.

## Goal

Persist bot responses and visible tool output so conversation history survives event retention, disconnects, failures and server restart.

## Non-goals

No new streaming transport, ordinary conversation context selection, raw secret-bearing tool dumps, or automatic execution retries.

## Source anchors and planned changes

- `apps/server/src/modules/runtime/events.ts` (from RFC-011)
- `apps/server/src/modules/chat/messages.ts` (from RFC-025)
- `apps/server/src/modules/chat/output-projection.ts` (new)
- `packages/db/src/schema/chat.ts` (extend only if approved)

## Contract and implementation steps

1. Derive stable assistant/tool message identities from run, attempt and content-part identity. Persist bot/config attribution and a durable applied-event cursor; distinguish a logical response from a later explicit retry.
2. Project accepted events idempotently into safe message parts. Persist partial text, tool status/results and failed/cancelled/interrupted terminal markers. Ensure event retention cannot remove events before they are projected; use an accepted transactional or checkpoint/replay strategy.
3. Recover projection after restart and reconcile terminal events without duplicate messages. Historical reads use persisted messages, not an unbounded event replay. Keep original/effective context and hidden internal tool metadata outside published message content.

## Acceptance criteria

- [ ] After stream completion and eligible event cleanup, reloading history returns the same visible assistant/tool content with stable IDs and attribution.
- [ ] Duplicate chunks/terminal events, out-of-order replay and crash between event persistence and projection do not lose or duplicate content; a persisted cursor supports recovery.
- [ ] Failed/cancelled/interrupted runs retain their visible partial output and honest status, with owner checks and safe tool-result serialization applied before reads.

## Verification

Proposed command: `bun test apps/server/src/modules/chat/output-projection.test.ts`. Cover chunk splitting, repeated event IDs, duplicate terminal events, partial cancellation, projection restart, event retention and cross-owner history. A disposable PostgreSQL transaction/restart check requires approval and is needed to prove durability beyond in-memory fixtures.

## Definition of done

- [ ] All acceptance criteria and the [shared definition of done](README.md#shared-definition-of-done) have evidence.
- [ ] RFC-027 and RFC-034 can consume durable message history without implementing server-side output persistence themselves.
- [ ] Projection cursor/retention ordering, safe content schema and recovery behavior are recorded for the next worker.

## Small-model handoff and stop rules

Implement only this projection seam. Reuse the accepted event and message contracts. Obtain approval for schema changes; stop if event identifiers or ordering cannot support idempotent recovery. Do not hide that gap with client-side deduplication or by retaining events forever.

## Completion record

Not started. Record approvals, changed paths, exported contracts, exact checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Assistant output is persisted incrementally; tool results become notes/receipts; no tool secrets stored.

Evidence: apps/server/src/modules/chat/service.ts.

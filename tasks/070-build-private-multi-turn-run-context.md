# RFC-070: Build private multi-turn run context

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-013](013-implement-pi-execution-adapter.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-069](069-persist-assistant-and-tool-output.md)
- **Execution position:** After RFC-069, before RFC-026. IDs are stable identifiers, not execution ranks.
- **Size target:** One focused session; about 2–5 product files plus tests.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and dependency handoffs, especially RFC-012's native resume evidence through RFC-013. This task owns the base context builder. Files, threads, hooks, instructions and memory extend this seam later instead of creating parallel context paths.

## Goal

Give each ordinary chat turn the correct bounded prior conversation and preserve isolation across conversations, users, restarts and harness sessions.

## Non-goals

No learned memory retrieval, autonomous summarization, attachment parsing, thread context, or assumption that native harness session resume is safe on every adapter.

## Source anchors and planned changes

- `apps/server/src/modules/runtime/context.ts` (new)
- `apps/server/src/modules/chat/turn-context.ts` (new)
- `apps/server/src/modules/chat/messages.ts`
- `apps/server/src/modules/runtime/worker.ts`

## Contract and implementation steps

1. Build context from an authorized conversation cutoff: applicable bot configuration, ordered prior user/assistant/tool parts and the current message exactly once. Define size limits and a visible truncation policy that preserves tool-call/result pairing. Never fetch all conversations for a shared bot.
2. Choose native resume only when RFC-012 proves safe ownership, compatible configuration and no duplicate history injection. Otherwise replay bounded persisted history. Key any native session by owner, conversation, bot, harness and relevant configuration; never reuse a session across those boundaries or after access revocation.
3. Serialize turns within the accepted conversation/session policy or reject overlapping sends visibly. Record the context cutoff and applied versions for each run. On restart, use verified resume or persisted-history replay; do not silently start a context-free conversation. Define extension inputs for later files/threads/hooks/knowledge without implementing those features now.

## Acceptance criteria

- [ ] A second-turn fixture receives the first user/bot exchange and the new prompt once; a different conversation or user receives none of that history.
- [ ] Restart, harness/model/configuration change and unsupported resume follow a documented replay/new-session policy without leaking native state or duplicating messages.
- [ ] Context limits, concurrent turns and tool-result pairing behave deterministically, with the cutoff/version recorded and any truncation visible rather than silently dropping the current request.

## Verification

Proposed command: `bun test apps/server/src/modules/chat/turn-context.test.ts`. Include two-turn continuity, A/B and two-conversation isolation, restart, native resume versus replay, stale session, overlapping turns and oversized history. One approved Pi two-turn smoke verifies actual protocol mapping; other adapters use the same contract and are verified in RFC-066/068.

## Definition of done

- [ ] All acceptance criteria and the [shared definition of done](README.md#shared-definition-of-done) have evidence.
- [ ] RFC-026 can send a real multi-turn chat; RFC-031/052/056/060 extend one existing context builder instead of inventing their own.
- [ ] Context precedence, native-session ownership, cutoff/concurrency and replay contracts are recorded with exact verification results.

## Small-model handoff and stop rules

Keep this task to base chat context. Do not add a summarizer, database of memories or speculative provider adapter. If a native session cannot prove ownership or configuration compatibility, use the accepted persisted-history path or report an explicit unsupported capability. Ask before schema/API changes.

## Completion record

Not started. Record approvals, changed paths, exported contracts, exact checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Multi-turn context: per-conversation/thread scope, current message once, byte budget with visible truncation.

Evidence: apps/server/src/modules/chat/context.ts, context.test.ts.

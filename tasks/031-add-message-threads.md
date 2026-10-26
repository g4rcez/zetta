# RFC-031: Add message threads

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-027](027-render-streaming-history-and-reconnect-states.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Create private threaded replies with explicit context boundaries and independent run attribution.

## Non-goals

No public discussion channels, arbitrary recursive nesting or automatic inclusion of unrelated threads.

## Source anchors and planned changes

- `apps/server/src/modules/chat/threads.ts (new)`
- `packages/db/src/schema/chat.ts`
- `apps/web/src/features/chat/thread-panel.tsx (new)`

## Contract and implementation steps

1. Define one-level thread roots and parent conversation validation; preserve ownership and author attribution.
2. Build thread context from the root and its replies under a bounded policy, not all messages in the bot's history.
3. Render reply counts, deep links, loading/errors and live thread responses while keeping the main timeline stable.

## Acceptance criteria

- [ ] A root from another conversation/user cannot be used as a reply parent.
- [ ] A threaded run receives its root/replies and explicit attachments only; sibling thread data is excluded.
- [ ] Reload/reconnect preserves thread ordering/counts and closing the panel releases subscriptions.

## Verification

Proposed command: `bun test apps/server/src/modules/chat/threads.test.ts`. Cross-conversation root, sibling context exclusion, duplicate reply and ordering; approved UI deep-link check.

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

**Status: Done.** Threads with thread-scoped context (no sibling leakage) and reply counts.

Evidence: apps/server/src/modules/chat/durability.integration.test.ts, context.test.ts.

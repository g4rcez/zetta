# RFC-033: Add message reactions

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-027](027-render-streaming-history-and-reconnect-states.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Persist the current user's reactions to messages in private conversations.

## Non-goals

No reactions on published read-only snapshots, notification system or implicit team chat.

## Source anchors and planned changes

- `apps/server/src/modules/chat/reactions.ts (new)`
- `packages/db/src/schema/chat.ts`
- `apps/web/src/features/chat/reactions.tsx (new)`

## Contract and implementation steps

1. Define a bounded accepted emoji representation and unique user/message/reaction key.
2. Implement idempotent add/remove with ownership checks; apply optimistic UI updates with rollback.
3. Render accessible labels and consistent reaction state after refresh or event replay.

## Acceptance criteria

- [ ] Duplicate add/remove requests converge to one correct persisted reaction state.
- [ ] A cannot react to B private message or any read-only snapshot.
- [ ] Rejected updates restore correct UI state and emoji inputs cannot become raw HTML.

## Verification

Proposed command: `bun test apps/server/src/modules/chat/reactions.test.ts`. Duplicate, race, invalid emoji, cross-owner and snapshot rejection fixtures; approved keyboard control check.

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

**Status: Done.** Reactions with allowlist, removal, counts and own state.

Evidence: apps/server/src/modules/features/wave.integration.test.ts.

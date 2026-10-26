# RFC-025: Persist private conversations and messages

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-005](005-enforce-actor-and-resource-access-boundaries.md), [RFC-009](009-persist-run-lifecycle-and-idempotency.md), [RFC-020](020-implement-versioned-bot-configuration.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Create multiple private chats per bot with stable message ordering and idempotent submissions.

## Non-goals

No shared live channels, message editing/deletion product policy or snapshot publication yet. RFC-069 owns durable assistant/tool output projection; RFC-070 owns multi-turn context. This task supplies their storage/submission contract.

## Source anchors and planned changes

- `packages/db/src/schema/chat.ts (new)`
- `apps/server/src/modules/chat/conversations.ts (new)`
- `apps/server/src/modules/chat/messages.ts (new)`

## Contract and implementation steps

1. Approve conversation/message schema, safe content parts, author identities and cursor pagination; bind chat ownership separately from bot visibility.
2. Implement create/list/history and atomic message submission with a client request key and run association.
3. Record bot/config version attribution and stable message/content-part identities for RFC-069 projection. Archive behavior preserves history while rejecting new work on unavailable bots. Do not expose an executable chat as complete until RFC-069/070 add durable output and multi-turn context.

## Acceptance criteria

- [ ] A shared bot has separate A/B conversations; no cross-owner history or identifier probing succeeds.
- [ ] Repeated send requests create one user message and one logical run; paged history has no gaps/duplicates.
- [ ] Rejected/failed submissions are distinguishable from accepted-but-running work, with stable message IDs.

## Verification

Proposed command: `bun test apps/server/src/modules/chat/messages.test.ts`. Include deduplication, same timestamps, pagination boundaries, cross-owner IDs and unavailable bot.

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

**Status: Done.** Private conversations; ordered messages; clientRequestId idempotency; cursor pagination; running/interrupted statuses.

Evidence: apps/server/src/modules/chat/durability.integration.test.ts.

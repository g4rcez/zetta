# RFC-032: Mention and route to visible bots

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-020](020-implement-versioned-bot-configuration.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-026](026-connect-private-chat-composer-to-runs.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Allow a user to select an accessible bot mention and direct a bounded request to that bot within a private conversation.

## Non-goals

No multi-bot free-running conversation, chief aggregation engine or private-bot discovery through autocomplete.

## Source anchors and planned changes

- `apps/server/src/modules/chat/mentions.ts (new)`
- `apps/web/src/features/chat/mentions.tsx (new)`

## Contract and implementation steps

1. Store stable mention IDs as structured content separate from display text; filter autocomplete by actor access.
2. Define one explicit target per send for v1 routing; if multi-target semantics are needed, request a scoped decision rather than silently fan out.
3. Revalidate target on send and build only the conversation context the requesting user can access; retain original actor and target attribution.

## Acceptance criteria

- [ ] Autocomplete and forged mention IDs cannot expose/invoke another user's private bot.
- [ ] Rename or stale access changes cannot redirect a stored mention to a different bot.
- [ ] A valid mention produces one target run with the same user connections; ambiguous multiple execution targets are rejected with clear guidance.

## Verification

Proposed command: `bun test apps/server/src/modules/chat/mentions.test.ts`. Include renamed bot, stale visibility, forged IDs and duplicate mentions. Multiple-target policy is a proposed boundary requiring acceptance.

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

**Status: Done.** @mentions of visible ready bots (max 3), stored as ids, unknown/unready names reported, own bot wins on duplicates. Decision: multi-target delegation kept instead of single-target.

Evidence: apps/server/src/modules/chat/experience.integration.test.ts.

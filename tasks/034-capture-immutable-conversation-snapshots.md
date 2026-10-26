# RFC-034: Capture immutable conversation snapshots

- **Module:** Chat publication
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-029](029-attach-owned-files-as-run-context.md), [RFC-030](030-reference-authorized-server-files.md), [RFC-031](031-add-message-threads.md), [RFC-033](033-add-message-reactions.md), [RFC-032](032-mention-and-route-to-visible-bots.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Publish the entire conversation content at a consistent cutoff without copying account/resource capabilities.

## Non-goals

No live sharing, public internet links, partial silent truncation or publication of hidden memory/configuration.

## Source anchors and planned changes

- `packages/db/src/schema/snapshots.ts (new)`
- `apps/server/src/modules/chat/snapshots.ts (new)`

## Contract and implementation steps

1. Approve a safe publication DTO: rendered message parts, visible tool results, threads, reactions and safe attachment content/metadata; exclude credentials, internal handles and live paths.
2. Capture all pages at one cutoff and copy safe attachment content into snapshot-owned storage; no dangling owner-only URLs. If a content part cannot be represented safely, block publication and explain the issue rather than silently omitting it. Show the exact safe publication representation before confirmation.
3. Implement owner publication confirmation, retention/revocation policy from RFC-001, idempotency and failure rollback. Publish only when capture is complete.

## Acceptance criteria

- [ ] Snapshot contains every eligible message/thread through the cutoff, including beyond one pagination page, and no later content.
- [ ] It contains no credential, live server-file URL, native tool handle, underlying memory or account permission; unsafe/unrepresentable content blocks publication with explanation.
- [ ] Concurrent new messages/file changes cannot mutate the snapshot, and failed captures leave no visible partial publication or orphan data.

## Verification

Proposed command: `bun test apps/server/src/modules/chat/snapshots.test.ts`. Cutoff race, multi-page threads, attachment freeze, unsafe parts, retries and interrupted capture; actual storage transaction proof needs approval.

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

**Status: Done.** Snapshots: preview hash confirmation, text-only safe copy (tool fences, attachment text, file/web-using chats blocked), idempotent, immutable (DB trigger), revocable.

Evidence: apps/server/src/modules/features/snapshots.ts; wave.integration.test.ts.

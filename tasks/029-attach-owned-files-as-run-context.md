# RFC-029: Attach owned files as run context

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-007](007-store-user-owned-connection-references.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-026](026-connect-private-chat-composer-to-runs.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Upload a bounded user-owned file and attach its safe representation to a private message/run.

## Non-goals

No unrestricted file hosting, arbitrary executable parsing, automatic third-party scanning service or snapshot sharing yet.

## Source anchors and planned changes

- `packages/db/src/schema/files.ts (new)`
- `apps/server/src/modules/files/uploads.ts (new)`
- `apps/web/src/features/chat/attachments.tsx (new)`

## Contract and implementation steps

1. Approve allowed content types, per-file/user limits, storage/retention and parsing policy; use opaque IDs instead of client paths.
2. Validate streaming byte limits and authorized attachment ownership; isolate any parsing and resolve capabilities for each harness.
3. Show upload/progress/error/remove states and delete abandoned uploads under the accepted retention policy.

## Acceptance criteria

- [ ] A cannot attach/read B files; MIME/name tricks, oversize streams and path traversal are rejected.
- [ ] A sent run sees only accepted bounded content with provenance; unsupported formats report an actionable error.
- [ ] Abandoned/failed uploads are cleaned up; attachment removal before send prevents inclusion in context.

## Verification

Proposed command: `bun test apps/server/src/modules/files/uploads.test.ts`. Include chunked limit overflow, filename traversal, fake MIME, A/B attachment IDs and orphan cleanup; storage integration requires approval.

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

**Status: Done.** Owner-only single-use text attachments (256KB), delete-before-send, orphan purge, sha256.

Evidence: apps/server/src/modules/chat/experience.integration.test.ts.

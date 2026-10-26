# RFC-035: Build team read-only snapshot viewer

- **Module:** Chat publication
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-024](024-build-chat-first-navigation-shell.md), [RFC-034](034-capture-immutable-conversation-snapshots.md), [RFC-028](028-add-safe-markdown-composition-and-rendering.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Let authorized team members view a published snapshot without gaining chat or execution capabilities.

## Non-goals

No reply/react/mention execution, source-account access, live updates or anonymous sharing.

## Source anchors and planned changes

- `apps/server/src/modules/chat/snapshot-view.ts (new)`
- `apps/web/src/features/chat/snapshot-view.tsx (new)`
- `apps/web/src/routes/_auth/ (snapshot route)`

## Contract and implementation steps

1. Authorize every snapshot and attachment read through current team membership and the accepted revocation policy.
2. Reuse safe message/thread rendering with all mutation controls removed and a clear snapshot timestamp/owner label.
3. Handle revoked/expired/unavailable snapshots and restrict file downloads to copied safe publication content.

## Acceptance criteria

- [ ] Team readers see frozen content but cannot call mutation/run endpoints through snapshot identifiers.
- [ ] Non-members and removed members cannot fetch snapshot pages or attachment bytes.
- [ ] Continuing the original private chat never changes the viewer; no source account/file link grants additional authority.

## Verification

Proposed command: `bun test apps/server/src/modules/chat/snapshot-view.test.ts`. Team/nonmember/removed member, mutation attempts and attachment capabilities; approved viewer UI check.

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

**Status: Done.** Team viewer with owner/time, revoked state, removed members denied.

Evidence: apps/server/src/modules/isolation-matrix.integration.test.ts; apps/web/src/features/studio/snapshots.tsx.

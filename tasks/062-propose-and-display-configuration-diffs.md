# RFC-062: Propose and display configuration diffs

- **Module:** Self-configuration
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-020](020-implement-versioned-bot-configuration.md), [RFC-021](021-build-bot-onboarding-and-settings.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Provide the versioned bot-configuration proposal foundation for self-improvement and user-requested setup through any bot, with an exact visible diff. Automatic learning is a consumer, not a prerequisite for setup.

## Non-goals

No automatic apply, owner/visibility/account privilege changes or approvals hidden in ordinary chat text.

## Source anchors and planned changes

- `packages/db/src/schema/config-proposals.ts (new)`
- `apps/server/src/modules/learning/config-proposals.ts (new)`
- `apps/web/src/features/bots/config-diff.tsx (new)`

## Contract and implementation steps

1. Define allowed fields and exclusions using RFC-001. Record initiating user, proposing bot, authorized target bot and target version separately. Self-initiated improvement targets the proposing bot; explicit user-requested assistance may target another bot the user can edit. Identity/account authority remains immutable.
2. Store base version/hash, complete proposed values, reason and provenance; generate a safe structured diff. RFC-073 extends this envelope to concrete routine/workflow creation/edit targets using their own domain services, not arbitrary model-selected database fields.
3. Show pending/rejected/stale states and explicit approve/reject controls to the authorized editor. Emit a stable needs-review item through RFC-071; read/acknowledge is not approval. Forms and chat refer to the same versioned proposal.

## Acceptance criteria

- [ ] Proposal creation cannot apply changes, alter user identity/account authority or target an unauthorized bot. An authorized user-requested edit can be proposed by a non-chief bot for another editable bot.
- [ ] The UI displays all actual changed fields against the recorded base, including removals; secrets are never part of the diff.
- [ ] A pending proposal remains inert after restart and only the correct editor sees actionable approval controls.

## Verification

Proposed command: `bun test apps/server/src/modules/learning/config-proposals.test.ts`. Forbidden paths, unauthorized target, authorized non-chief cross-bot proposal, hidden field change, stale base and inert restart; approved diff UI check. Setup must work without a learned lesson or RFC-061 execution.

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

**Status: Done.** Bot-proposed changes (config and creations) are persisted proposals with exact diffs and attention cards; nothing applies automatically.

Evidence: apps/server/src/modules/chat/tools.integration.test.ts.

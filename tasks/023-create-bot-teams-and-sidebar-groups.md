# RFC-023: Create bot teams and sidebar groups

- **Module:** Bots and teams
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-001](001-approve-domain-and-ownership-contracts.md), [RFC-020](020-implement-versioned-bot-configuration.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Organize visible bots into workspaces (visual bot teams) and inner list groups without changing ownership, authorization or credentials.

## Non-goals

No team-map canvas, inferred human membership changes or implicit bot access grants.

## Source anchors and planned changes

- `packages/db/src/schema/bot-teams.ts (new)`
- `apps/server/src/modules/bot-teams/ (new)`
- `apps/web/src/features/teams/ (new)`

## Contract and implementation steps

1. Use workspace as the user-facing name for visual bot teams. Approve bot placement cardinality and ordering; implement create/rename/reorder/group operations. Existing proposed bot-teams paths may remain internal naming; do not add a second workspace membership/ACL model.
2. Filter bot entries by actor visibility on every read; reject inaccessible private bot IDs in writes.
3. Expose a small list-based management UI and safe empty/archive states; keep bot definitions independent of group deletion.

## Acceptance criteria

- [ ] Team/group order persists after reload and duplicate/stale reorder requests have deterministic behavior.
- [ ] Private bot membership never exposes its name/configuration to other users.
- [ ] Moving/removing a workspace or group changes organization only: no bot/account/chat/run deletion, chief duplication, attention-card sharing or new access grant occurs.

## Verification

Proposed command: `bun test apps/server/src/modules/bot-teams/groups.test.ts`. Cover reorder, duplicate membership policy, hidden bots and group removal; approved manual list-management check.

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

**Status: Done.** Nested workspaces with rename/delete that only ungroup; never access boundaries.

Evidence: apps/server/src/modules/chat/chat.integration.test.ts.

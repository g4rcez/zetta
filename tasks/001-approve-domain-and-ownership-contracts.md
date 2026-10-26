# RFC-001: Approve domain and ownership contracts

- **Module:** Foundation
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Research / decision
- **Dependencies:** None
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Freeze the minimum domain vocabulary and access matrix so small-model workers do not invent incompatible ownership rules.

## Non-goals

No production schema, endpoint, full RBAC system, billing tenancy or implementation.

## Source anchors and planned changes

- `docs/decisions/ownership.md`
- `packages/auth/src/index.ts`
- `packages/db/src/schema/auth.ts`
- `drafts/ui.md`

## Contract and implementation steps

1. Separate human membership from workspaces (visual bot teams/groups); propose the smallest installation model and get approval for membership cardinality/enrollment. Local Zetta authentication and authorization are enforced, not audit-only. Workspace movement never changes access.
2. Define owner/editor/use/view operations for bots, personal chiefs, connections, chats, routines/workflows, memories/instructions, snapshots, attention items and browser/computer sessions. Specify per-user onboarding evidence and same-user-only profile sharing. Set membership-removal/revocation rules.
3. Record actor propagation and source identities. A workspace switch must not create another chief or share pending work. Any bot may assist configuration only under the initiating user's target-edit authority; the chief has orchestration duties, not an authorization bypass.

## Acceptance criteria

- [ ] A two-user access matrix states allow/deny for every named resource and distinguishes team visibility from internet publication.
- [ ] The owner approves enrollment, single-admin bootstrap/recovery, shared-bot editing, team membership and snapshot lifecycle decisions.
- [ ] The decision records which fields are server-derived and which changes require explicit approval; no task can change owner identity through configuration.

## Verification

Review matrix with users A/B, an admin, two bot groups and one private bot; trace chat, routine, delegation and publication identities.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Accepted artifact: `docs/decisions/ownership.md`. Cite evidence and owner approval; unresolved decisions keep dependent implementation blocked.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Policy accepted by the user in the implementation conversation: “Approve with the defaults.” Accepted artifact: [ownership decision](../docs/decisions/ownership.md). It records the A/B/admin access matrix, closed enrollment, per-user visual organization, owner-only edits, operator-controlled sole-admin bootstrap/recovery, removal and snapshot lifecycle. The matrix was traced through two groups, private/shared bots, chat, routine, delegation and publication; this is policy review, not runtime evidence.

Changed paths: `docs/decisions/ownership.md`, this completion record and the root index. Exported contract: server-derived actor/ownership, no workspace/chief authority escalation, revocable access to immutable snapshot content, and explicit approval/version rules. Native Bun focused single-file tests were also approved with no new dependency.

Unblocks policy prerequisites for RFC-002/003 and downstream domain design. Exact auth/schema/API/bootstrap mechanics, retention duration, isolation topology and environment checks remain approval/evidence gates. No builds, providers, migrations or runtime probes were run. The root index records task status; implementation remains separate.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Unchanged: ownership contract accepted earlier.

Evidence: docs/decisions/ownership.md.

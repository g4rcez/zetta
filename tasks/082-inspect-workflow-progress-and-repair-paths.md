# RFC-082: Inspect workflow progress and repair paths

- **Module:** Visual workflows
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-027](027-render-streaming-history-and-reconnect-states.md), [RFC-071](071-define-common-in-app-attention-state.md), [RFC-081](081-build-visual-workflow-editor.md), [RFC-072](072-build-user-attention-kanban.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Expose workflow task attribution, partial results and safe recovery in the graph/list and shared attention surfaces.

## Non-goals

No second attention store, separate artifact management or universal resume/retry control.

## Source anchors and planned changes

- `apps/web/src/features/workflows/run-view.tsx (new)`
- `apps/server/src/modules/workflows/history.ts (new)`
- `apps/server/src/modules/attention/ (workflow producer)`

## Contract and implementation steps

1. Map durable step IDs to responsible bots, recorded branch decisions, completed/skipped/blocked/uncertain states and authorized output links. Keep layout independent from state.
2. Publish blockers into RFC-071 using source identity so the same item appears consistently in kanban/sidebar/activity. Link to setup/takeover/configuration repair and return to the originating workflow step.
3. Retain completed output and explain which steps a new attempt would repeat. Enable continuation only when backend state and external effects permit it; otherwise require an explicit new attempt and never infer success from card resolution.

## Acceptance criteria

- [ ] A mixed-outcome workflow shows who did what, which branch ran, what remains and durable results after refresh.
- [ ] A blocked node produces one private attention item with a working repair-and-return link and no duplicate card on replay.
- [ ] Repair does not restart successful or uncertain actions automatically; cancellation and unsupported continuation are clearly explained.

## Verification

Proposed command: `bun test apps/server/src/modules/workflows/history.test.ts`. Partial outputs, scoped links, duplicate attention and repair policies; approved graph/list/kanban walkthrough verifies the same task state.

Use synthetic data and record exact results. Do not run builds, full suites, E2E, provider calls or infrastructure checks without approval. Fixture success is not real compatibility proof.

## Definition of done

- [ ] All acceptance criteria and the [shared definition of done](README.md#shared-definition-of-done) have evidence; research decisions include source/version and approval references.
- [ ] The next worker has concrete exported contracts, safe failure/recovery behavior and authorized UI entry/return points; no private credentials or content appear in logs/fixtures.
- [ ] Focused checks, changed paths, unresolved blockers and newly unblocked tasks are recorded below. Required functionality cannot be silently deferred when an integration is unavailable.

## Small-model handoff and stop rules

Implement only this RFC after prerequisite acceptance. Reuse the existing run, actor, configuration and attention contracts. Stop for undocumented provider behavior, new dependency/infrastructure needs or a change to confirmed product behavior. Do not broaden scope or mark unverified runtime behavior done.

## Completion record

Not started. Record approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks and remaining risks here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Run view with per-step status, skipped and branch, bot attribution; failures raise one attention card with completed/remaining and a repair link.

Evidence: apps/server/src/modules/features/workflows.ts.

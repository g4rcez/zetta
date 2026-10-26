# RFC-072: Build user-attention kanban

- **Module:** Attention and task management
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-071](071-define-common-in-app-attention-state.md), [RFC-024](024-build-chat-first-navigation-shell.md), [RFC-027](027-render-streaming-history-and-reconnect-states.md), [RFC-037](037-aggregate-bounded-specialist-work.md), [RFC-041](041-show-routine-run-history-and-outcomes.md), [RFC-044](044-configure-bot-integration-bindings.md), [RFC-063](063-apply-only-explicitly-approved-versions.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Create a dedicated kanban section for pending tasks needing the user, linked to the existing sidebar/activity attention model.

## Non-goals

No general project-management suite, independent task/run state, artifact library, external push or approval by drag-and-drop.

## Source anchors and planned changes

- `apps/web/src/features/attention/kanban.tsx (new)`
- `apps/web/src/features/attention/task-card.tsx (new)`
- `apps/web/src/routes/_auth/ (attention route)`
- `apps/server/src/modules/attention/ (query integration)`

## Contract and implementation steps

1. Use needs-input and blocked/repair columns plus a resolved follow-up view; validate labels with the owner. Show originating task, responsible bot, delegated parent, completed/remaining/uncertain work and durable result/origin links. Workspace filters are visual only.
2. Connect chat failures, specialist blocks, routine failures and configuration proposals through RFC-071 producers; include browser/workflow producers as their RFCs land. Deduplicate one problem seen in chat, sidebar and board rather than creating three tasks.
3. Offer clear answer/repair/review/return actions and a keyboard-accessible list alternative. Preserve filters and selection across repair navigation. Read/resolve actions follow the source contract; disable meaningless card movement.

## Acceptance criteria

- [ ] A mixed fixture of chat, delegated, routine and proposal items shows correct attribution and the same attention state as sidebar/activity after reload.
- [ ] A user can open a blocker, inspect partial results, perform the authorized repair and return to the same task; uncertain effects require a deliberate new attempt, not automatic replay.
- [ ] Private cards/counts/links remain private even in shared workspaces, and keyboard users can complete all required actions without changing run state by dragging.

## Verification

Proposed command: `bun test apps/web/src/features/attention/kanban-state.test.ts`. State mapping, duplicate sources, link return, private filtering and stale cards; approved browser check covers kanban/list navigation and configuration approval source actions.

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

**Status: Done.** Attention kanban (open/acknowledged/resolved + dismissed) with attribution, completed/remaining and result links.

Evidence: apps/web/src/features/studio/attention.tsx.

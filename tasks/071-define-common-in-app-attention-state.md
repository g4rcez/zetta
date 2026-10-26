# RFC-071: Define common in-app attention state

- **Module:** Attention and task management
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-005](005-enforce-actor-and-resource-access-boundaries.md), [RFC-009](009-persist-run-lifecycle-and-idempotency.md), [RFC-011](011-expose-owned-run-events-with-replay.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Provide one actor-owned attention contract for sidebar, activity and kanban without replacing run state or audit logs.

## Non-goals

No external notifications, new permission designer, arbitrary manual task tracker or dependence on the finished kanban.

## Source anchors and planned changes

- `apps/server/src/modules/attention/state.ts (new)`
- `packages/db/src/schema/attention.ts (new)`
- `apps/server/src/modules/attention/projection.ts (new)`

## Contract and implementation steps

1. Define a stable source key (actor, originating task/run/proposal and issue generation), responsible bot, reason, safe next action, authorized origin/result links and timestamps. Keep queued/working execution, needs-input/blocked attention, and unread-result acknowledgment as separate fields.
2. Persist idempotent open/update/resolve events and per-user read state; define precedence so an unread result cannot hide a blocker. Expired/revoked targets become safe unavailable states rather than leaking titles or paths.
3. Export a typed producer interface, actor-scoped query/acknowledgment service and authorized web transport for later chat/delegation/routine/proposal/browser/workflow producers. Define input, repair and review reasons without conflating them with run status. Resolution requires the underlying repair/answer/approval event; marking read only acknowledges visibility.

## Acceptance criteria

- [ ] The same source issue has one stable identity across replay/restart and yields consistent labels/counts in all consumers.
- [ ] Two users of the same bot/workspace cannot see or mutate each other's attention items; nested links are authorized on access.
- [ ] Acknowledge, resolve, cancel and approve are distinct operations; reading or moving a card cannot mark work successful or authorize an action.

## Verification

Proposed command: `bun test apps/server/src/modules/attention/state.test.ts`. Cover duplicate producer events, recurrence generations, blocked+unread precedence, read-state reload, revoked links and A/B isolation. PostgreSQL persistence checks need approval.

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

**Status: Done.** Attention state: deduplicated cards (source key + occurrences), read/acknowledge/resolve/cancel/reopen, summary for badges; never changes execution state.

Evidence: apps/server/src/modules/features/attention.ts.

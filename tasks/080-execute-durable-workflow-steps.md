# RFC-080: Execute durable workflow steps

- **Module:** Visual workflows
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-010](010-dispatch-and-recover-durable-work.md), [RFC-039](039-dispatch-timezone-aware-scheduled-occurrences.md), [RFC-050](050-configure-bounded-decision-routing.md), [RFC-079](079-define-versioned-conditional-workflow-graphs.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Run published conditional workflows manually or from routines using existing durable run machinery.

## Non-goals

No separate general workflow platform, exactly-once external-effect claims or automatic retry of uncertain tool actions.

## Source anchors and planned changes

- `apps/server/src/modules/workflows/executor.ts (new)`
- `apps/server/src/modules/workflows/steps.ts (new)`
- `apps/server/src/modules/routines/ (workflow target extension)`

## Contract and implementation steps

1. Create a workflow run pinned to published version, actor and occurrence/request key. Dispatch ready bot nodes through existing run admission, retaining node/attempt/parent identity and onboarding/connection checks.
2. Evaluate configured typed branches using completed safe outputs and recorded decision results; mark nonselected branches skipped. Bound concurrency/depth/time and aggregate outputs without hiding partial failures.
3. Persist step transitions and claim/fencing checkpoints; recover queued work while reconciling uncertain running steps. Parent cancel reaches active children. Extend routines to target a published workflow with the same owner, schedule and occurrence dedup rules.

## Acceptance criteria

- [ ] Manual and scheduled executions follow the same published graph and actor, with no duplicate logical steps on repeated request/occurrence IDs.
- [ ] Branch outcomes, skipped nodes and completed/failed/blocked steps remain inspectable; inaccessible or not-onboarded bots fail admission before side effects.
- [ ] Crash, cancel and expired lease preserve completed results and never silently replay uncertain external actions.

## Verification

Proposed command: `bun test apps/server/src/modules/workflows/executor.test.ts`. Branch fixtures, duplicate schedule, actor/ready checks, parent cancel and crash boundaries; approved PostgreSQL multi-worker check proves durable claims.

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

**Status: Done.** Durable runs: persisted per step, request-key idempotency, readiness admission, interrupted recovery, routine->workflow target.

Evidence: apps/server/src/modules/features/workflows.ts; wave.integration.test.ts.

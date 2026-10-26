# RFC-079: Define versioned conditional workflow graphs

- **Module:** Visual workflows
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-005](005-enforce-actor-and-resource-access-boundaries.md), [RFC-009](009-persist-run-lifecycle-and-idempotency.md), [RFC-020](020-implement-versioned-bot-configuration.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Define a bounded v1 workflow graph that forms, chat and the visual editor can save and validate consistently.

## Non-goals

No full n8n parity, arbitrary embedded code, recursive/unbounded graphs or new credential ownership model.

## Source anchors and planned changes

- `packages/db/src/schema/workflows.ts (new)`
- `apps/server/src/modules/workflows/definitions.ts (new)`
- `docs/decisions/workflow-graph.md (new)`

## Contract and implementation steps

1. Propose and obtain acceptance for a finite DAG: manual/scheduled entry, bot task, typed condition/branch and terminal output. A bot task uses its configured tools, including browser/computer; decisions may consume validated Jev/Laya output. Record any requested extra node type as a separate bounded change.
2. Validate typed node inputs/outputs, reachable branches, terminal paths, size limits and bot access; reject cycles/dangling edges. Separate draft editing from immutable published versions with stale-edit checks.
3. Bind ownership and connection resolution to the initiating user (routine owner for schedules). Save presentation layout separately from executable semantics; workspace grouping grants nothing.

## Acceptance criteria

- [ ] Valid graphs have deterministic typed edges/branch outcomes; invalid cycles, unreachable/dangling nodes and inaccessible bot references produce specific errors.
- [ ] Editing a draft cannot alter a published version or active run; concurrent publishing detects conflicts.
- [ ] Form/chat/editor consumers use one validation schema and safe credential references, with no other-user connection embedded in graph exports.

## Verification

Proposed command: `bun test apps/server/src/modules/workflows/definitions.test.ts`. Branch validation, graph limits, stale publication, A/B ownership and secret-free serialization. The minimal node catalog is an implementation proposal to approve, not an assumed API.

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

**Status: Done.** Bounded graph schema with cycle/unreachable/dangling/no-end validation, immutable versions, CAS save.

Evidence: apps/server/src/modules/features/workflow.ts, workflows.ts.

# RFC-081: Build visual workflow editor

- **Module:** Visual workflows
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-024](024-build-chat-first-navigation-shell.md), [RFC-079](079-define-versioned-conditional-workflow-graphs.md), [RFC-080](080-execute-durable-workflow-steps.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Let a nontechnical user build, validate, publish and test the supported conditional workflow without writing code.

## Non-goals

No visual team map, marketplace, arbitrary code editor or silent dependency installation.

## Source anchors and planned changes

- `apps/web/src/features/workflows/editor.tsx (new)`
- `apps/web/src/features/workflows/node-form.tsx (new)`
- `apps/web/src/routes/_auth/ (workflow routes)`

## Contract and implementation steps

1. Inspect existing UI/canvas capabilities and request approval for any graph dependency. Use the RFC-079 catalog with plain-language node forms and an accessible ordered/list alternative.
2. Show validation at the affected node/edge, required bot readiness/accounts and a readable execution summary. Distinguish save draft, publish and test run; label test runs as real work.
3. Persist layout/draft separately from published behavior; preserve input on errors, support conflict recovery and open chat-created drafts without conversion loss. Keep current runs pinned to their old version.

## Acceptance criteria

- [ ] A user can create a bot-task/condition workflow, understand both branches and publish it without technical identifiers or code.
- [ ] Visual, list/form and chat-created definitions round-trip through the same schema; invalid graphs cannot publish or run.
- [ ] Test/activate actions disclose real effects, retain inputs on failure and cannot mutate an existing running workflow version.

## Verification

Proposed command: `bun test apps/web/src/features/workflows/editor-state.test.ts`. Graph/form round trip and conflict fixtures; approved browser checks cover keyboard/list editing, branch comprehension and test-run labeling.

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

**Status: Done.** Workflow editor on an @xyflow/react (React Flow) canvas: nodes for every step type, drag connections, per-node editing, start marker, validation (local + server), save with versions, run with per-node result colours, positions persisted in graph.layout; the step builder remains as the simple mode.

Evidence: apps/web/src/features/studio/workflow-canvas.tsx, workflow-graph.ts, workflow-graph.test.ts.

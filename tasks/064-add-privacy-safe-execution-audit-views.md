# RFC-064: Add privacy-safe execution audit views

- **Module:** Operations and release
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-011](011-expose-owned-run-events-with-replay.md), [RFC-041](041-show-routine-run-history-and-outcomes.md), [RFC-052](052-execute-bounded-hooks-around-model-calls.md), [RFC-057](057-expose-controlled-memory-write-tools.md), [RFC-063](063-apply-only-explicitly-approved-versions.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Make run, delegation, hook, decision, memory-write and configuration-change outcomes diagnosable without logging private content.

## Non-goals

No raw prompt/tool payload logging, new telemetry vendor or admin access to all private conversations.

## Source anchors and planned changes

- `apps/server/src/modules/audit/ (new)`
- `apps/server/src/index.ts (existing evlog wiring)`
- `apps/web/src/features/activity/ (new)`

## Contract and implementation steps

1. Define event metadata with actor/run/parent/config identifiers, status, duration and safe reason codes; use existing evlog conventions.
2. Instrument lifecycle transitions and denied actions without credentials, message text or unredacted host paths.
3. Expose actor-scoped activity/run detail with correlation and authorized repair/result links; define admin metadata access under RFC-001. Consume RFC-071's attention state so sidebar/activity/kanban agree. Audit events explain what happened; they are not the attention queue or source of truth for resolving tasks.

## Acceptance criteria

- [ ] A failed scheduled/delegated/hook task can be traced to its owned originating action with reason and timing.
- [ ] Synthetic secrets and private source content never appear in captured logs/API audit DTOs.
- [ ] Users cannot query other users' activity details; admin visibility matches the accepted minimal policy.

## Verification

Proposed command: `bun test apps/server/src/modules/audit/events.test.ts`. Redaction snapshots, correlation links, denied access and missing-provider error fixtures.

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

**Status: Done.** Owner-scoped activity trail with closed codes; canary secret never appears.

Evidence: apps/server/src/modules/features/audit.ts; activity.integration.test.ts.

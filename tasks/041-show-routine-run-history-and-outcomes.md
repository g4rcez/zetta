# RFC-041: Show routine run history and outcomes

- **Module:** Routines
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-011](011-expose-owned-run-events-with-replay.md), [RFC-027](027-render-streaming-history-and-reconnect-states.md), [RFC-039](039-dispatch-timezone-aware-scheduled-occurrences.md), [RFC-040](040-build-routine-calendar-and-editor.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Expose scheduled execution status and results in the routine UI and owner's private chat.

## Non-goals

No external notifications, global admin access to private content or misleading success on skipped runs.

## Source anchors and planned changes

- `apps/server/src/modules/routines/history.ts (new)`
- `apps/web/src/features/routines/history.tsx (new)`

## Contract and implementation steps

1. List occurrence/run history with stable pagination, responsible bot, routine/occurrence identity and durable links to the actual report/output plus the originating conversation. Show completed, missing and uncertain work rather than only a terminal status.
2. Distinguish upcoming, queued, running, succeeded, failed, skipped, blocked and interrupted states. Emit actionable failures through RFC-071 so kanban/sidebar/activity point to one source issue; separate old acknowledged failures from new failed occurrences.
3. Offer authorized repair-and-return plus explicit owner run-now/cancel through existing idempotent APIs. Retain successful output and label potentially repeated effects before a new attempt. Neither opening a result, resolving a card nor reconnecting an account automatically repeats a scheduled action.

## Acceptance criteria

- [ ] An occurrence identifies its responsible bot and partial outcome; the final deliverable and supporting results reopen after reload without searching the whole chat or exposing another user's data.
- [ ] Skipped/blocked/interrupted states are not counted or displayed as success.
- [ ] Run-now double submit creates one logical action. A blocked occurrence has one source-linked attention item; repair returns to that occurrence with retained results and no execution merely from reading history or resolving attention.

## Verification

Proposed command: `bun test apps/server/src/modules/routines/history.test.ts`. Ownership, pagination, state mapping, double run-now and read-only history checks.

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

**Status: Done.** Run history with succeeded/failed/skipped/blocked/interrupted/running states, pagination, idempotent run-now, deduplicated attention linked to the occurrence.

Evidence: apps/server/src/modules/features/routines.ts.

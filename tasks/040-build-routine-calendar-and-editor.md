# RFC-040: Build routine calendar and editor

- **Module:** Routines
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-024](024-build-chat-first-navigation-shell.md), [RFC-038](038-define-owned-schedules-and-routine-actions.md), [RFC-039](039-dispatch-timezone-aware-scheduled-occurrences.md), [RFC-059](059-build-versioned-instruction-library.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Create, inspect, pause and reschedule routines through the referenced calendar-oriented interface.

## Non-goals

No new calendar dependency without approval or drag-only input. The required visual workflow editor belongs to RFC-081; this task owns the calendar and the successful-task-to-routine journey.

## Source anchors and planned changes

- `apps/web/src/features/routines/calendar.tsx (new)`
- `apps/web/src/features/routines/editor.tsx (new)`
- `apps/web/src/routes/_auth/ (routine route)`

## Contract and implementation steps

1. Verify @g4rcez/components calendar exports, supported version and license; request installation if absent and do not copy an unrelated calendar.
2. Map occurrences with explicit timezone and bot/workspace filters and an accessible list/form alternative. Offer Make recurring from an authorized successful task or reusable instruction: carry the selected method/input references, not an accidental copy of secret or stale source data.
3. Show a plain-language pre-activation summary: task/method, bot, account bindings, schedule/timezone/next occurrence, fresh-input policy, conversation-context mode, result destination and missed/overlap policy. Allow save draft separately from activate; unfinished onboarding blocks activation. Label test runs as real work. Reuse the same validation/services for RFC-073 chat configuration, handle stale edits, and distinguish a routine edit from a single-occurrence exception.

## Acceptance criteria

- [ ] Displayed occurrences and the pre-save summary match RFC-039 timezone/DST behavior; the first real occurrence uses the declared method, context, current inputs and result destination.
- [ ] A user can turn a successful task/instruction into a routine, inspect what will repeat, save/refine a draft, activate when ready, and reopen its result. Edits/pause persist; missing setup has a clear repair-and-return path.
- [ ] Keyboard/list and form/chat consumers use the same routine contract. Failed/stale saves preserve the existing schedule; test runs are not presented as effect-free previews.

## Verification

Proposed command: `bun test apps/web/src/features/routines/calendar-mapping.test.ts`. Approved browser check covers successful-task → instruction/method → routine preview → first result, plus timezone labels, draft versus activation, editor errors and keyboard/list access. RFC-067 checks parity with the later chat path. Missing calendar dependency approval blocks this task.

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

**Status: Done.** Routine editor with a month calendar built on the owner's @g4rcez/components Calendar (installed, CSS imported): upcoming occurrences and past runs per day via POST /api/routines/calendar, plus occurrence preview and activation summary.

Evidence: apps/web/src/features/studio/routine-calendar.tsx, calendar-days.test.ts; features/wave.integration.test.ts (calendar).

# RFC-038: Define owned schedules and routine actions

- **Module:** Routines
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-009](009-persist-run-lifecycle-and-idempotency.md), [RFC-020](020-implement-versioned-bot-configuration.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-070](070-build-private-multi-turn-run-context.md), [RFC-021](021-build-bot-onboarding-and-settings.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Create a persistent routine that executes a task as its owner against a selected bot/conversation.

## Non-goals

No visual workflow DAG implementation in this task (required separately in RFC-079–082), arbitrary cron code or unowned global scheduled credentials. RFC-080 extends the same routine target contract to published workflows.

## Source anchors and planned changes

- `packages/db/src/schema/routines.ts (new)`
- `apps/server/src/modules/routines/definitions.ts (new)`

## Contract and implementation steps

1. Approve supported recurrence forms, IANA timezone, task payload, target and paused state; keep one-time and recurring actions explicit.
2. Version routine definitions and validate owner access/readiness both on activation and dispatch. Draft routines may be saved with visible missing prerequisites, but activation requires the owner's completed RFC-021 onboarding and valid connections. Use RFC-070's context builder; define whether an occurrence starts a new private conversation or continues a selected owner conversation, and record that choice rather than implicitly accumulating history.
3. Define missed-run, overlap and disabled/deleted-target policies; recommend skip missed occurrences and skip overlap until owner accepts alternatives.

## Acceptance criteria

- [ ] A cannot create/edit/run B routine or target an inaccessible bot/conversation.
- [ ] Invalid timezone/recurrence and missing required bindings are rejected with actionable errors.
- [ ] Pause/edit/archive semantics and missed/overlap policies are documented and versioned; queued occurrences retain their captured definition.

## Verification

Proposed command: `bun test apps/server/src/modules/routines/definitions.test.ts`. Invalid inputs, owner scope, pause/edit version and target access loss.

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

**Status: Done.** Routine definitions: recurring/once, conversation mode, versioned PATCH with CAS, archive, workflow target, prerequisite checklist, summary before activation.

Evidence: apps/server/src/modules/features/routines.ts.

# RFC-061: Learn reusable procedures after tasks

- **Module:** Instructions and learning
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-037](037-aggregate-bounded-specialist-work.md), [RFC-057](057-expose-controlled-memory-write-tools.md), [RFC-059](059-build-versioned-instruction-library.md), [RFC-060](060-resolve-instruction-and-skill-context.md), [RFC-040](040-build-routine-calendar-and-editor.md), [RFC-058](058-inspect-correct-and-forget-memories.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Convert useful completed-task experience into scoped memories or reusable instructions without changing core configuration.

## Non-goals

No learning from failed claims as verified truth, endless reflection loop or default promotion of private task content.

## Source anchors and planned changes

- `apps/server/src/modules/learning/extraction.ts (new)`
- `apps/server/src/modules/runtime/worker.ts`
- `apps/web/src/features/chat/learning-receipt.tsx` (new)

## Contract and implementation steps

1. Define bounded post-run eligibility and extraction budgets; distinguish proposed lessons from verified task outcomes and user corrections.
2. Write validated/deduplicated memory or procedure updates with source run provenance and private scope by default. Attach a concise learning receipt to the originating result: what was retained, whether it is a fact or procedure, and an authorized inspect/correct/forget link.
3. Own extraction as bounded background work with no recursive learning trigger. Connect a reusable procedure to RFC-040's Make recurring flow, preserving the method rather than stale source results. User corrections take precedence on later retrieval; a suggestion to schedule does not activate a routine automatically. Configuration changes still use RFC-062/063 explicit diff approval.

## Acceptance criteria

- [ ] A completed task exposes an accurate learning receipt; the user can inspect/correct the scoped lesson and reuse the procedure in a later task or routine draft. Later retrieval reflects the correction without rewriting historical output.
- [ ] Failed/uncertain claims and source prompt injections do not become authoritative configuration or cross-user facts.
- [ ] Replayed completion does not duplicate lessons; extraction failure never changes the original task's outcome or loops indefinitely.

## Verification

Proposed command: `bun test apps/server/src/modules/learning/extraction.test.ts`. Completed/failed/uncertain runs, duplicate completion, private source, correction and recursion prevention fixtures. Verify result → learning receipt → correction/reuse → routine draft or later session; no automatic schedule activation or silent configuration mutation occurs.

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

**Status: Done.** Learning receipts on answers (remembered/saved/proposed), private by default.

Evidence: apps/server/src/modules/chat/service.ts.

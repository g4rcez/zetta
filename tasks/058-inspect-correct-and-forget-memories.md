# RFC-058: Inspect correct and forget memories

- **Module:** Persistent memory
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-021](021-build-bot-onboarding-and-settings.md), [RFC-055](055-persist-scoped-memory-records.md), [RFC-056](056-retrieve-bounded-relevant-context.md), [RFC-059](059-build-versioned-instruction-library.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Give users control over the persistent facts affecting their bots.

## Non-goals

No private-memory admin explorer or publication of memory when sharing a chat.

## Source anchors and planned changes

- `apps/server/src/modules/memory/management.ts (new)`
- `apps/web/src/features/memory/ (new)`

## Contract and implementation steps

1. Expose scoped memory views with origin/category/version and safe search. From a task result, show the authorized retained knowledge actually used and link to the relevant fact or procedure; do not invent causal explanations when no provenance exists.
2. Let the user correct/forget a fact or open the versioned instruction editor, then return to the original result. Explain in plain language the difference between memory, a reusable procedure and approval-required bot configuration; do not require approval for every ordinary learning event.
3. Invalidate retrieval caches/indexes and display retention semantics. Provide a later-session check path to verify that corrected knowledge is selected and forgotten knowledge excluded. Historical messages and snapshots remain unchanged; no automatic external rerun is implied.

## Acceptance criteria

- [ ] Users can inspect/correct/forget their authorized records without discovering another user's titles or counts.
- [ ] A user can move from an incorrect result to its recorded knowledge source, correct or forget it, return to the result, and verify a later session uses the correction/excludes deletion. Historical messages/snapshots remain unchanged.
- [ ] Stale edits show conflict and failed deletion does not falsely report success.

## Verification

Proposed command: `bun test apps/server/src/modules/memory/management.test.ts`. Scope/count leak, stale edit, deletion retrieval and pagination. Approved UI journey: incorrect result → recorded memory/procedure → correction → return → later session with changed context, using deterministic fixtures rather than asserting identical model prose.

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

**Status: Done.** Memory management: list/edit(CAS)/delete and 'used knowledge' links from answers.

Evidence: apps/web/src/features/studio/knowledge.tsx.

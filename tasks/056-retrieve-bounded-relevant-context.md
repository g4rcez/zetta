# RFC-056: Retrieve bounded relevant context

- **Module:** Persistent memory
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-055](055-persist-scoped-memory-records.md), [RFC-006](006-define-harness-contract-and-fixture-adapter.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-070](070-build-private-multi-turn-run-context.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Load relevant authorized memories into each run without flooding context or crossing privacy boundaries.

## Non-goals

No global shared vector search, unbounded history injection or treating memory text as higher-priority instructions.

## Source anchors and planned changes

- `apps/server/src/modules/memory/retrieval.ts (new)`
- `apps/server/src/modules/runtime/context.ts` (extend the builder from RFC-070)

## Contract and implementation steps

1. Implement the accepted retrieval mechanism with actor/bot/scope filtering before ranking and deterministic tie/correction precedence.
2. Budget count/bytes/tokens using the verified harness capability and keep provenance on selected items.
3. Extend RFC-070's existing context builder for chat, scheduled and delegated work; preserve its history/cutoff and native-session isolation rules. Do not create a second context-construction path.

## Acceptance criteria

- [ ] A/B identical queries on one shared bot return only authorized records; filtering does not occur after leaking candidates.
- [ ] Context stays within configured limits and newer accepted corrections supersede stale contradictory facts.
- [ ] Deleted records and prompt-injection memory cannot reappear via cache or alter actor/configuration authority.

## Verification

Proposed command: `bun test apps/server/src/modules/memory/retrieval.test.ts`. Scoped ranking, budget cutoff, correction precedence, deletion invalidation and hostile memory fixtures.

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

**Status: Done.** Retrieval ranked by relevance within byte budgets; notes labelled as data, never instructions.

Evidence: apps/server/src/modules/features/knowledge.ts.

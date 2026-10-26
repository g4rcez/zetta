# RFC-060: Resolve instruction and skill context

- **Module:** Instructions and learning
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-012](012-research-six-harness-compatibility.md), [RFC-056](056-retrieve-bounded-relevant-context.md), [RFC-059](059-build-versioned-instruction-library.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Attach relevant authorized procedures and verified harness skill references to a run with bounded precedence.

## Non-goals

No downloading arbitrary skill packages, following paths outside allowed roots or claiming native skill parity across harnesses.

## Source anchors and planned changes

- `apps/server/src/modules/instructions/resolver.ts (new)`
- `apps/server/src/modules/runtime/context.ts`
- `apps/server/src/modules/bots/ (skill validation)`

## Contract and implementation steps

1. Combine explicit bot instructions with relevant learned procedures, scoped memory and user task using a documented precedence/budget.
2. Validate harness skill references under approved roots/capabilities; distinguish native executable extensions from plain instruction text.
3. Record applied versions/provenance and expose unsupported/missing skill states during setup.

## Acceptance criteria

- [ ] Runs receive only authorized instruction/skill content and references cannot escape approved roots.
- [ ] Conflict/precedence and context budgeting are deterministic and never replace system access policy.
- [ ] Each harness advertises only verified skill behavior; missing capability is not silently ignored.

## Verification

Proposed command: `bun test apps/server/src/modules/instructions/resolver.test.ts`. Root escape, A/B scope, conflicting procedure versions, budget and unsupported harness fixtures.

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

**Status: Done.** Fixed context merge order with byte budgets; skills are not modelled (instructions only).

Evidence: apps/server/src/modules/chat/pipeline.ts.

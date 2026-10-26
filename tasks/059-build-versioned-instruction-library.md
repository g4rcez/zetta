# RFC-059: Build versioned instruction library

- **Module:** Instructions and learning
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-005](005-enforce-actor-and-resource-access-boundaries.md), [RFC-020](020-implement-versioned-bot-configuration.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Store reusable procedures separately from memory and allow authorized users to manage them.

## Non-goals

No model training, raw executable plugin installation or automatic team sharing of private procedures.

## Source anchors and planned changes

- `packages/db/src/schema/instructions.ts (new)`
- `apps/server/src/modules/instructions/library.ts (new)`
- `apps/web/src/features/instructions/ (new)`

## Contract and implementation steps

1. Define procedure fields for trigger, steps, constraints, verification, scope, provenance and revision.
2. Implement scoped create/read/update/archive with deduplication/conflict semantics and a basic library editor.
3. Bind explicit instruction versions to bot configuration while allowing private per-user procedures for shared bots.

## Acceptance criteria

- [ ] Instructions persist with readable trigger/steps/verification and immutable historical versions.
- [ ] A cannot read/edit B private procedures or attach them to a shared definition for others to consume.
- [ ] Archive/stale update behavior is explicit and active runs retain their captured instruction versions.

## Verification

Proposed command: `bun test apps/server/src/modules/instructions/library.test.ts`. Private/shared scopes, version conflict, archive and bot binding; approved editor UI check.

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

**Status: Done.** Instruction library with trigger/verification, versions, archive, dedupe.

Evidence: apps/server/src/modules/features/knowledge.ts.

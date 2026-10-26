# RFC-054: Select Hermes memory mechanism

- **Module:** Persistent memory
- **Status:** Review; see [root index](../TASKS.md).
- **Type:** Research / decision
- **Dependencies:** [RFC-001](001-approve-domain-and-ownership-contracts.md), [RFC-002](002-prove-multi-user-execution-isolation.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Identify the intended Hermes mechanism and define a durable, scoped reuse strategy backed by evidence.

## Non-goals

No assumption of a hosted Hermes API, new vector database, model training or automatic use of the current agent's personal memory store.

## Source anchors and planned changes

- `docs/decisions/hermes-memory.md`
- `docs/intent/zetta-v1.md`
- `packages/db/package.json`

## Contract and implementation steps

1. Identify upstream mechanism/package and exact revision with owner confirmation; document license, storage/retrieval/write semantics and integration hooks.
2. Compare direct reuse with compatible semantics on current PostgreSQL; prefer existing dependencies and record approval for any new package.
3. Define namespaces, provenance, size limits, deletion, conflicts, correction precedence and harness interoperability. Explicitly disable/contain native global harness memory that bypasses Zetta scopes.

## Acceptance criteria

- [ ] Decision states exactly what is reused from Hermes and what is implemented locally, with source/version evidence.
- [ ] Two-user/shared-bot and personal-chief scenarios preserve privacy across all six harnesses and restarts.
- [ ] Retention/deletion and native harness memory boundaries are approved; unresolved product identity or licensing blocks implementation.

## Verification

Review synthetic memory lifecycle examples, source references and data-flow diagram. Do not import existing private memories or install packages.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Accepted artifact: `docs/decisions/hermes-memory.md`. Cite evidence and owner approval; unresolved decisions keep dependent implementation blocked.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Not started. The implementing worker records approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Review.** Memory design recorded; persistent memory proven across restarts via Postgres. Owner approvals and a six-harness privacy proof are open (blocked on harness access).

Evidence: docs/decisions/hermes-memory.md.

## Owner approval (2026-10-23)

The owner confirmed the Hermes-style memory behaviour for v1 as implemented (bounded user/bot stores, add/patch/remove batches, final-size budget, frozen per-conversation snapshot, entry screening, per-user isolation). Evidence: `docs/decisions/hermes-memory.md` (Implemented in v1) and `apps/server/src/modules/features/memory.integration.test.ts`. Remaining for the six-harness privacy proof: Codex, Pi, OMP (usage limit until 2026-10-29) and Cursor (CLI not installed).

## Completion update (2026-10-23)

**Status: Done.** Owner decision (2026-10-23): memory behaviour approved; test only with Claude. real-memory.integration.test.ts (ZETTA_REAL_HARNESS_TEST=1, real claude haiku) proves: the bot writes through zetta:remember, the fact is recalled in a new conversation, and a second user never sees it. Other harnesses are not tested by owner decision.

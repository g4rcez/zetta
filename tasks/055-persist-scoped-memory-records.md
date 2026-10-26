# RFC-055: Persist scoped memory records

- **Module:** Persistent memory
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-005](005-enforce-actor-and-resource-access-boundaries.md), [RFC-054](054-select-hermes-memory-mechanism.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Provide durable memory storage with explicit scope, version and provenance independent of chat text.

## Non-goals

No automatic promotion to team scope, embedding infrastructure or storing account tokens as memories.

## Source anchors and planned changes

- `packages/db/src/schema/memory.ts (new)`
- `apps/server/src/modules/memory/store.ts (new)`

## Contract and implementation steps

1. Implement approved Hermes-compatible schema for owner/scope/bot association, category, content, provenance, revisions and lifecycle.
2. Enforce scope on every CRUD/query; require explicit authorized sharing and make safe private scope the learning default.
3. Bound content/record counts and define correction/update conflict handling, deletion and retention processing.

## Acceptance criteria

- [ ] Memory survives restart and A cannot read/write/delete B memory through IDs or filters.
- [ ] Version conflicts and duplicate writes are deterministic, with provenance retained and secrets rejected/redacted under policy.
- [ ] Deleted/expired records are excluded from future retrieval and any secondary indexes/caches are invalidated.

## Verification

Proposed command: `bun test apps/server/src/modules/memory/store.test.ts`. A/B scopes, version conflict, duplicate content, retention and deletion; approved persistence integration proves restart behavior.

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

**Status: Done.** Memory store: owner-scoped, versioned, deduplicated by hash, capped (200), secret-screened.

Evidence: apps/server/src/modules/features/knowledge.ts; wave.integration.test.ts.

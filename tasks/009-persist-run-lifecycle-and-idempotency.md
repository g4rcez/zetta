# RFC-009: Persist run lifecycle and idempotency

- **Module:** Execution runtime
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-005](005-enforce-actor-and-resource-access-boundaries.md), [RFC-006](006-define-harness-contract-and-fixture-adapter.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Represent every requested execution as a durable owned run with validated state transitions.

## Non-goals

No scheduler recurrence, automatic external-effect retry or complete workflow engine.

## Source anchors and planned changes

- `packages/db/src/schema/runs.ts (new)`
- `apps/server/src/modules/runtime/runs.ts (new)`

## Contract and implementation steps

1. Approve schema for immutable actor/origin/config version, logical request key, attempt identity and terminal result.
2. Implement request deduplication and legal transitions for queued/running/succeeded/failed/cancelled/interrupted states with concurrency checks.
3. Separate logical runs from attempts and record ambiguous external outcomes explicitly; do not reinterpret interrupted as safe to retry.

## Acceptance criteria

- [x] Repeated same-owner request keys return one logical run; the same key from another user cannot expose it.
- [x] Competing completion/cancel updates yield one valid terminal outcome with traceable timestamps.
- [x] Stored actor and configuration version cannot change after submission, and restart retains status.

## Verification

Proposed command: `bun test apps/server/src/modules/runtime/runs.test.ts`. Include transition table, cross-owner idempotency, stale update and competing terminal cases; prove unique constraints in an approved PostgreSQL test.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [x] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [x] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Do not leave mock success paths in production code.
- [x] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Accepted [009a design](009a-design-run-and-attempt-storage.md), generated/custom schema [009b1](009b1-define-durable-run-schema.md), strict canonical/transition contracts [009b2a](009b2a-harden-run-row-validation.md) and owned store [009c1](009c1-implement-owned-run-store.md). createRunStore exposes submitOwned/getOwned/getResultOwned/cancelOwned with issued actors, fresh membership, owner-scoped queries, exact canonical deduplication and atomic run/attempt projections. The separate trusted applyRunTransition requires caller-owned authorization/transaction; it is absent from the owner API. Unknown mutation acknowledgement has fixed outcome_unknown; no retry or owner completion setter exists.

| Acceptance | Actual evidence |
| --- | --- |
| Ownership, uniqueness and immutability | [009b1a](009b1a-verify-durable-run-schema.md): worker47959 and coordinator57029 each69 real PG checks/four observed RC/RR races, zero orphans and exact cleanup; independent CLEAR. |
| Same-key repair, cross-owner/nested/admin/removed denials and terminal races | [009c2](009c2-verify-owned-run-store.md): worker72180/coordinator74183 each15 scenarios/seven observed races; real rollback and postcommit-response-loss wrapper; matching terminal timestamps retained; independent CLEAR. |
| Real service-process crash/restart | [009c3](009c3-verify-run-process-restart.md): worker98147/coordinator54755 each committed writer SIGKILL/reap/backend disappearance, distinct reader process/client recovering identical DTO/result/canonical fingerprint and six ownership denials; exact cleanup; independent CLEAR. |

Focused checks passed: corrected contract/state30 tests/179 assertions, owned store/rows42/273, proof guards/launcher38/455, strict TypeScript and DB package check-types. Each child records its exact commands/hashes and failures; accepted red reader regressions remain retained. No blocking review finding remains. Verification uses synthetic data on fresh owned services and removes exact clients/processes/container/network. No production migration, dependency install or Git mutation.

Integration limits remain explicit: only trusted fixture producers can currently submit;020/025 must prove real bot/conversation/configuration access/readiness before public use. Synthetic backend facts prove persistence, not launcher/worker authority.010 owns real claims/leases/grants/capacity/reconciliation;011/025 own events/conversation retention. The restart proof kills an application proof process, not PostgreSQL or its host. Future production DB roles must lack TRUNCATE/DDL authority. These are downstream obligations, not undisclosed storage acceptance deferrals.

Later010 integration accepted [009c4 pure cancellation before admission](009c4-define-no-admission-cancellation.md): independent87tests/578assertions/strict prove the closed no-effect terminal shape and replay without inventing stop/owner intent. Actual locked absence of prepare/grants/possible startup and claim release remain010 service obligations. [009d1 immutable producer schema](009d1-define-run-producer-schema.md) is being prepared offline for durable eligibility; no legacy trust is backfilled. Its new-lineage application, closed row parser and fresh membership-revision stamping must be accepted before running updated run/dispatch services or claiming restart-safe producer authority. Historical storage proof receipts/SQL remain frozen at their tested boundary.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Turn lifecycle is durable: assistant rows are written as running, flushed while streaming, finish as complete/failed/cancelled, boot marks interrupted; idempotent sends via clientRequestId. (The older run-store proof library is unused by the product path.)

Evidence: apps/server/src/modules/chat/durability.integration.test.ts.

# RFC-052: Execute bounded hooks around model calls

- **Module:** Hooks
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-010](010-dispatch-and-recover-durable-work.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-050](050-configure-bounded-decision-routing.md), [RFC-051](051-define-ordered-hook-contracts.md), [RFC-070](070-build-private-multi-turn-run-context.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Run the ordered hook pipeline once per logical message and own any resulting background work.

## Non-goals

No retrying side-effecting hooks blindly, indefinite middleware or hidden nested provider calls.

## Source anchors and planned changes

- `apps/server/src/modules/hooks/pipeline.ts (new)`
- `apps/server/src/modules/chat/messages.ts`
- `apps/server/src/modules/runtime/worker.ts`

## Contract and implementation steps

1. Insert accepted stages into RFC-070's context builder before model submission; preserve immutable original content and separately recorded effective/redacted content. Apply redaction to the effective context, including replayed history where configured, rather than constructing a second context path.
2. Apply ordered context/transforms and stop without invoking the harness; connect Jev/Laya routing through typed outcomes.
3. Enqueue background actions as owned durable runs with deduplication, cancellation and visible status; propagate deadlines and pipeline errors.

## Acceptance criteria

- [ ] Transform order is deterministic and a stop outcome prevents any harness call.
- [ ] Repeated submit/recovery does not duplicate hooks/background jobs or leak original redacted content into model context.
- [ ] Timeout/malformed outcome/error is visible under accepted policy and cannot hang the chat or lose actor identity.

## Verification

Proposed command: `bun test apps/server/src/modules/hooks/pipeline.test.ts`. Ordered transforms, stop, redaction boundary, timeout, background dedup and cancellation fixtures.

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

**Status: Done.** Ordered execution, redaction of history, stop on redacted text, background hooks owned and deduplicated by idempotent turns.

Evidence: apps/server/src/modules/chat/pipeline.ts; wave.integration.test.ts.

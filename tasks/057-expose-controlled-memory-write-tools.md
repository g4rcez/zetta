# RFC-057: Expose controlled memory write tools

- **Module:** Persistent memory
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-055](055-persist-scoped-memory-records.md), [RFC-056](056-retrieve-bounded-relevant-context.md), [RFC-006](006-define-harness-contract-and-fixture-adapter.md), [RFC-013](013-implement-pi-execution-adapter.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Let bots remember/update/forget scoped facts through validated Zetta tools rather than raw storage access.

## Non-goals

No bot-selected owner identity, silent team publishing or access to database credentials.

## Source anchors and planned changes

- `apps/server/src/modules/memory/tools.ts (new)`
- `apps/server/src/modules/runtime/context.ts`

## Contract and implementation steps

1. Define typed memory operations grounded in Hermes research and attach actor/bot identity from the run, not model arguments.
2. Validate category/content/provenance/budgets and idempotency; require explicit authorization for any broader scope.
3. Register tools against RFC-006's shared host-tool interface and prove the binding with RFC-013's Pi adapter; return safe acknowledgements/errors and record scoped write metadata. RFC-066/068 own real cross-harness verification for the other five adapters.

## Acceptance criteria

- [ ] Forged owner/scope fields cannot write to another user or promote private memory to team scope.
- [ ] Repeated tool calls converge under a request key and malformed/oversized/secret-bearing content is rejected.
- [ ] Shared server-side enforcement and a real Pi tool round trip are verified; the other five adapters reuse this contract and their real compatibility remains gated by RFC-066/068. Unsupported native tool exposure is visible, never claimed as supported.

## Verification

Proposed command: `bun test apps/server/src/modules/memory/tools.test.ts`. Forged identity/scope, retry, malformed content and deletion; approved harness smoke verifies actual tool exposure.

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

**Status: Done.** Memory/instruction write tools validated, owner-forced, secret-screened, idempotent.

Evidence: apps/server/src/modules/chat/tools.ts, tools.integration.test.ts.

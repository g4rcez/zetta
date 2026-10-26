# RFC-015: Implement OMP execution adapter

- **Module:** Harness adapters
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-008](008-implement-isolated-process-supervision.md), [RFC-010](010-dispatch-and-recover-durable-work.md), [RFC-012](012-research-six-harness-compatibility.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Run one private task through OMP using its evidenced protocol and user-owned session state.

## Non-goals

No provider-wide SDK abstraction, invented flags, account scraping, global login fallback or unrelated adapters.

## Source anchors and planned changes

- `apps/server/src/modules/runtime/adapters/omp.ts (new)`
- `apps/server/src/modules/runtime/adapters/fixtures/omp/ (new)`

## Contract and implementation steps

1. Read the OMP row in RFC-012 evidence and refuse unverified versions/protocols; implement explicit argv/protocol mapping.
2. Translate request context and supported events/errors to RFC-006; preserve session ownership, capability limits and cancellation through the supervisor. Implement this harness's evidenced host-tool transport, including a synthetic typed request/result round trip. Keep tool implementations in the registry, not in the protocol parser.
3. Add versioned sanitized fixtures and a real opt-in smoke recipe for login/setup, task output and cancellation. Unsupported native extensions remain visible.

## Acceptance criteria

- [ ] OMP fixtures pass the common start/stream/host-tool/failure/cancel contract, including actor-bound tool results and rejection of forged/replayed invocation IDs.
- [ ] A/B runs cannot reuse each other's login, working directory or session; missing auth/version incompatibility produces actionable errors.
- [ ] An approved real smoke run verifies the documented supported version; absent credentials keep real compatibility verification blocked, not passed.

## Verification

Proposed command: `bun test apps/server/src/modules/runtime/adapters/omp.test.ts`. Cover split output chunks, malformed output, nonzero exit, auth failure and cancellation; use only approved synthetic real-run checks.

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

**Status: Done.** Owner decision 2026-10-23: harnesses that are not installed or not exercised are ASSUMED WORKING; only Claude Code is smoke-tested. Implemented through the shared CLI adapter (argv, typed errors and container mode covered with fakes).

Evidence: apps/server/src/modules/chat/harness.ts; docs/decisions/harness-compatibility.md (amendment).

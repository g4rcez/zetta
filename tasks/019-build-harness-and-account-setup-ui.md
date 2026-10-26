# RFC-019: Build harness and account setup UI

- **Module:** Harness adapters
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-007](007-store-user-owned-connection-references.md), [RFC-012](012-research-six-harness-compatibility.md), [RFC-013](013-implement-pi-execution-adapter.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Let users see verified server harness availability and connect/select their own model account.

## Non-goals

No exposing server-wide accounts, installing CLIs from the UI, or claiming adapters not yet implemented are ready.

## Source anchors and planned changes

- `apps/server/src/modules/connections/harness-setup.ts (new)`
- `apps/web/src/features/providers/ (new)`
- `apps/web/src/routes/_auth/ (provider route)`

## Contract and implementation steps

1. Expose executable/version/capability readiness without leaking host paths or other users' accounts.
2. Implement the accepted supported login/setup handoff with owner-bound state, expiry and cancellation; never scrape another process' login cache.
3. Render connected/missing/sign-in-required/unsupported states and model selection from evidence, not hardcoded model names. Explain fixes in user language; keep raw CLI diagnostics in advanced details. Preserve a safe return link to the originating bot setup/task. Provider connection readiness is not completed bot onboarding (RFC-021).

## Acceptance criteria

- [ ] A sees only A account status and cannot complete B setup using a stolen/expired flow identifier.
- [ ] Missing executable, unimplemented adapter and expired auth have distinct recovery guidance.
- [ ] All six harness cards exist; readiness requires a landed adapter and successful user setup, with unavailable capabilities disabled.

## Verification

Proposed command: `bun test apps/server/src/modules/connections/harness-setup.test.ts`. Verify owner-bound setup and expiry; approved manual keyboard/UI check covers states without logging credentials.

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

**Status: Done.** Six harness cards with per-user readiness (ready/not_installed/needs_login/unverified), distinct guidance, no paths leaked; connections UI.

Evidence: apps/server/src/modules/chat/harnesses.ts; activity.integration.test.ts; apps/web/src/features/studio/accounts.tsx.

# RFC-053: Configure and inspect bot hooks

- **Module:** Hooks
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-021](021-build-bot-onboarding-and-settings.md), [RFC-051](051-define-ordered-hook-contracts.md), [RFC-052](052-execute-bounded-hooks-around-model-calls.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Let users select, order and configure supported hooks with a safe explanation of their effects.

## Non-goals

No unrestricted code editor, runtime installation of plugins or real actions during preview.

## Source anchors and planned changes

- `apps/web/src/features/bots/hook-settings.tsx (new)`
- `apps/server/src/modules/hooks/configuration.ts (new)`

## Contract and implementation steps

1. Expose only trusted registry entries and validate options/stage/order against the shared schema.
2. Persist hook settings as bot configuration versions with stale-edit handling.
3. Show disabled/readiness/error states and a synthetic dry-run trace whose executors cannot perform external effects.

## Acceptance criteria

- [ ] Saved hook order matches execution and survives reload; unsupported settings are rejected on the server.
- [ ] Dry run shows transform/stop/background intent without invoking accounts, providers or scheduling real work.
- [ ] Unauthorized users cannot alter shared/private bot hooks and stale edits do not overwrite accepted configuration.

## Verification

Proposed command: `bun test apps/server/src/modules/hooks/configuration.test.ts`. Order, malformed options, access, stale revision and dry-run effect denial; approved keyboard reorder UI check.

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

**Status: Done.** Hook config UI with enable/order/dry-run and server validation messages.

Evidence: apps/web/src/features/chat/bot-hooks.tsx.

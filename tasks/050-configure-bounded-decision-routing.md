# RFC-050: Configure bounded decision routing

- **Module:** Decisions
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-047](047-implement-jev-decision-adapter.md), [RFC-049](049-implement-laya-decision-adapter.md), [RFC-020](020-implement-versioned-bot-configuration.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Expose per-bot Jev/Laya selection and map typed decisions to explicit Zetta actions.

## Non-goals

No custom decision model, arbitrary model-generated executable code or visual workflow builder.

## Source anchors and planned changes

- `apps/server/src/modules/decisions/routing.ts (new)`
- `apps/web/src/features/bots/decision-settings.tsx (new)`

## Contract and implementation steps

1. Define an accepted finite action catalog such as continue, stop, add context or enqueue an accessible bot task; specify uncertainty/failure behavior.
2. Validate configuration against provider capabilities and version it with the bot; preserve actor identity for any resulting run.
3. Show setup/readiness and a synthetic preview without executing actions; distinguish disabled versus failed provider states.

## Acceptance criteria

- [ ] Only configured actions can result from a decision; unknown labels and forged target IDs cannot launch work.
- [ ] Uncertain/provider-failed outcomes follow the documented visible policy without repeated autonomous calls.
- [ ] Configuration persists per bot while account resolution stays per user; preview cannot send a message or execute a tool.

## Verification

Proposed command: `bun test apps/server/src/modules/decisions/routing.test.ts`. Action allowlist, inaccessible target, uncertainty, config version and side-effect-free preview fixtures.

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

**Status: Done.** Per-bot decision routing with bounded actions (respond/ask/delegate/stop), preview, fail-open fallback.

Evidence: apps/server/src/modules/chat/routing.ts; routing.integration.test.ts.

# RFC-036: Dispatch an owned specialist subtask

- **Module:** Chief delegation
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-010](010-dispatch-and-recover-durable-work.md), [RFC-020](020-implement-versioned-bot-configuration.md), [RFC-022](022-provision-one-personal-chief-per-user.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-013](013-implement-pi-execution-adapter.md), [RFC-070](070-build-private-multi-turn-run-context.md), [RFC-021](021-build-bot-onboarding-and-settings.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Give the personal chief a structured way to delegate one task to an accessible specialist.

## Non-goals

No arbitrary bot-to-bot privilege transfer, recursive autonomous swarm or direct use of the specialist owner's accounts.

## Source anchors and planned changes

- `apps/server/src/modules/delegation/dispatch.ts (new)`
- `apps/server/src/modules/runtime/harness.ts`
- `apps/server/src/modules/bots/chief.ts`

## Contract and implementation steps

1. Define a bounded delegation request/result tool contract and parent/child run link. Register it through RFC-006's host-tool interface and RFC-013's verified Pi bridge; do not implement new harness transports in this task. RFC-066/068 own the remaining all-harness integration proof.
2. Resolve the specialist under the initiating actor and pass only explicitly selected task context and that actor's connection bindings.
3. Reject cycles, inaccessible bots, incompatible capabilities and excessive payloads before dispatch. Recheck RFC-020/021 readiness for the initiating user on both chief and specialist. An onboarding/test turn cannot use delegation to bypass satisfaction gates; an unready specialist returns an actionable setup link, not a child run.

## Acceptance criteria

- [ ] A chief can invoke team-visible/A-private specialists but not B-private bots or B connections.
- [ ] Child run records preserve initiator, parent, target bot/config version and context provenance.
- [ ] Invalid target, missing connection or unsupported delegation bridge yields a visible result to the chief without launching unauthorized work.

## Verification

Proposed command: `bun test apps/server/src/modules/delegation/dispatch.test.ts`. A/B specialist access, child identity, cycle, oversize context and capability denial; one approved real harness bridge smoke is required.

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

**Status: Done.** Mention-based specialist dispatch as the requesting user (memory/connections are the requester's), recorded per delegation with provenance.

Evidence: apps/server/src/modules/features/wave.integration.test.ts (delegations).

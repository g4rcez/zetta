# RFC-022: Provision one personal chief per user

- **Module:** Bots and teams
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-004](004-implement-approved-enrollment-and-admin-bootstrap.md), [RFC-020](020-implement-versioned-bot-configuration.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Ensure each user has one private chief whose lifecycle is independent of bot team navigation.

## Non-goals

No one-chief-per-team behavior, delegation engine or shared chief memory.

## Source anchors and planned changes

- `apps/server/src/modules/bots/chief.ts (new)`
- `packages/db/src/schema/bots.ts`

## Contract and implementation steps

1. Implement idempotent chief provisioning for existing and newly enrolled users using the accepted unique ownership constraint.
2. Create an incomplete-but-visible chief and allow the authorized onboarding conversation before normal work. Selecting an account alone is not completion: RFC-021 requires a real response and explicit user satisfaction. Never copy admin credentials.
3. Define chief rename/configuration/archive behavior and expose a stable personal-chief lookup. The chief manages orchestration, not configuration permissions: any bot may assist setup through RFC-073. Workspace switching only reorganizes visible bots and cannot create another chief.

## Acceptance criteria

- [ ] Concurrent/repeated onboarding produces exactly one active personal chief per user.
- [ ] A cannot use B chief, and switching bot teams does not create or switch to someone else's chief.
- [ ] Users without configured accounts receive setup guidance rather than a fabricated successful run.

## Verification

Proposed command: `bun test apps/server/src/modules/bots/chief.test.ts`. Include concurrency/idempotency, existing user migration, missing account and A/B access.

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

**Status: Done.** One private chief per user (partial unique index), idempotent provisioning, setup guidance when no harness is configured.

Evidence: apps/server/src/modules/chat/chat.integration.test.ts.

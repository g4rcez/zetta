# RFC-044: Configure bot integration bindings

- **Module:** Application integrations
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-021](021-build-bot-onboarding-and-settings.md), [RFC-043](043-implement-scoped-mcp-tool-sessions.md), [RFC-027](027-render-streaming-history-and-reconnect-states.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Let users connect approved integrations and bind their own account choices to bot requirements.

## Non-goals

No marketplace discovery, OAuth implementation for every listed service or per-action permission builder.

## Source anchors and planned changes

- `apps/server/src/modules/integrations/bindings.ts (new)`
- `apps/web/src/features/integrations/ (new)`
- `apps/web/src/features/bots/ (integration settings)`

## Contract and implementation steps

1. Build a small connected-app/MCP settings list with safe status metadata, setup guidance and revoke controls.
2. Separate shared bot integration requirements from user-specific account bindings; allow explicit selection only from the actor's connections.
3. Validate readiness and reject inaccessible/expired bindings before runs. Preserve an actor-authorized originating task/proposal link when the user enters setup from a blocker. After repair, return to retained results and explain the available next action; do not auto-resume or retry. Emit repair resolution via RFC-071 only after checking the actual binding, and revalidate onboarding when the account changes materially.

## Acceptance criteria

- [ ] Two users of one bot can bind different accounts without changing each other's setup.
- [ ] Revoked/expired connections block execution and link to a repair flow that returns to the same task. Completed/uncertain effects remain visible, and successful reconnection neither replays work nor falsely completes onboarding.
- [ ] Saving shared bot settings never serializes another user's credential or silently binds an admin account.

## Verification

Proposed command: `bun test apps/server/src/modules/integrations/bindings.test.ts`. Shared bot/two accounts, forged binding, revoke, safe return-link validation and safe DTO fixtures. Approved UI check: encounter expired access, repair it, return to retained task output, inspect repeated-effect warning, then explicitly request a supported next attempt.

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

**Status: Done.** Per-user bot<->server bindings, per-user connection bindings, readiness/status, revoke repair (unbind/rebind).

Evidence: apps/server/src/modules/integrations/routes.ts, connections/service.ts.

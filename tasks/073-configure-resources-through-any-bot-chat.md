# RFC-073: Configure resources through any bot chat

- **Module:** Self-configuration
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-020](020-implement-versioned-bot-configuration.md), [RFC-021](021-build-bot-onboarding-and-settings.md), [RFC-026](026-connect-private-chat-composer-to-runs.md), [RFC-038](038-define-owned-schedules-and-routine-actions.md), [RFC-063](063-apply-only-explicitly-approved-versions.md), [RFC-075](075-manage-scoped-browser-profiles.md), [RFC-079](079-define-versioned-conditional-workflow-graphs.md), [RFC-081](081-build-visual-workflow-editor.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Let any authorized bot assist a user in creating/configuring bots, routines and workflow drafts through conversation, using the same services as forms. A bot in its bounded setup conversation may help refine its own setup; that exception does not admit unrelated ordinary work.

## Non-goals

No chief-only setup privilege, credentials in chat, bypass of target ownership or silent model-applied configuration changes.

## Source anchors and planned changes

- `apps/server/src/modules/configuration/chat-tools.ts (new)`
- `apps/server/src/modules/learning/config-proposals.ts`
- `apps/server/src/modules/learning/config-approval.ts`
- `apps/web/src/features/chat/configuration-card.tsx (new)`

## Contract and implementation steps

1. Register typed configuration tools with initiating user, proposing bot, target type/ID and version. Reuse bot/routine/workflow/profile validation and mutation services; extend the proposal envelope only for those concrete targets. Resolve account choices through safe IDs, never secret values.
2. Collect missing inputs in plain language, produce an exact diff or new-resource summary, and provide explicit save/approve/reject controls. Forms and chat can open the same draft/version. Existing bot edits use RFC-063 compare-and-swap; creation has its own idempotency key.
3. Route login/profile setup to secure views, then return to the proposal/conversation. Newly created bots remain in onboarding until RFC-021 passes. Saving a draft never executes work; activation/publication uses the same ready-state checks as forms. Restrict an unready bot's setup tool set to authorized self-refinement, never delegating/scheduling around readiness. Autonomous self-proposals still require approval.

## Acceptance criteria

- [ ] The same bot/routine/workflow draft configured by a form or a non-chief bot validates and persists identically; the chief has no special configuration bypass.
- [ ] Forged targets, other-user bindings, stale drafts, duplicate approvals and source-injected requests cannot change unauthorized state; credentials never enter transcripts.
- [ ] The user can refine/reject a proposal, complete required setup and return to the exact draft; a created bot is not marked ready until real conversation and explicit satisfaction.

## Verification

Proposed command: `bun test apps/server/src/modules/configuration/chat-tools.test.ts`. Form/chat parity, non-chief target edits, create dedup, stale version, secure setup return and onboarding gating; approved real host-tool smoke verifies the conversation path.

Use synthetic data and record exact results. Do not run builds, full suites, E2E, provider calls or infrastructure checks without approval. Fixture success is not real compatibility proof.

## Definition of done

- [ ] All acceptance criteria and the [shared definition of done](README.md#shared-definition-of-done) have evidence; research decisions include source/version and approval references.
- [ ] The next worker has concrete exported contracts, safe failure/recovery behavior and authorized UI entry/return points; no private credentials or content appear in logs/fixtures.
- [ ] Focused checks, changed paths, unresolved blockers and newly unblocked tasks are recorded below. Required functionality cannot be silently deferred when an integration is unavailable.

## Small-model handoff and stop rules

Implement only this RFC after prerequisite acceptance. Reuse the existing run, actor, configuration and attention contracts. Stop for undocumented provider behavior, new dependency/infrastructure needs or a change to confirmed product behavior. Do not broaden scope or mark unverified runtime behavior done.

## Completion record

Not started. Record approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks and remaining risks here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Chat configuration of bots, routines and workflows through proposals needing approval; unready bots cannot use browser/MCP tools.

Evidence: apps/server/src/modules/chat/tools.integration.test.ts.

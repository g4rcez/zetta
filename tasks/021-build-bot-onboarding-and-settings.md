# RFC-021: Build bot onboarding and settings

- **Module:** Bots and teams
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-019](019-build-harness-and-account-setup-ui.md), [RFC-020](020-implement-versioned-bot-configuration.md), [RFC-026](026-connect-private-chat-composer-to-runs.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Guide a nontechnical user from bot configuration to a real harness conversation and explicit satisfaction, only then completing onboarding.

## Non-goals

No full app catalog, automatically granting all user connections or placeholder save actions.

## Source anchors and planned changes

- `apps/web/src/features/bots/ (new)`
- `apps/web/src/routes/_auth/ (bot routes)`
- `packages/ui/src/components/ (reuse)`

## Contract and implementation steps

1. Build friendly job/name/account forms with sensible defaults and advanced settings disclosed only when needed. Persist a resumable draft; explain missing setup in plain language and return from provider setup to the same bot. Use the personal chief as the initial entry point without preventing direct specialist setup.
2. Run an explicitly marked onboarding conversation through RFC-026/070 and the actual selected harness/account/model. Save response evidence against the actor/bot/configuration-binding fingerprint. A detected executable, fixture response or saved form cannot satisfy this gate. After initial messages, the bot asks whether the user is satisfied; a negative answer returns to refinement and another test.
3. Complete onboarding only on an explicit positive user confirmation tied to that question and tested fingerprint. Provide a Yes/Keep adjusting control or an explicitly correlated user reply; silence, reactions and assistant-authored consent are not approval. Preserve state across refresh, invalidate stale tests after meaningful changes, and publish outstanding setup questions through RFC-071. RFC-073 later exposes the same draft/confirmation services to any bot chat.

## Acceptance criteria

- [ ] A user can configure a bot, complete required account setup, return without losing progress and receive a real response; saved settings, fixtures, unavailable models and missing credentials never mark onboarding complete.
- [ ] Only an explicit positive satisfaction response after the tested conversation marks that actor/bot ready; No, silence, stale confirmation, model-authored approval and configuration/account changes cannot bypass the gate. B remains unready when A onboards a shared bot.
- [ ] The user can refine, retest and confirm using accessible plain-language controls after reload; private account names stay private and ordinary chat/delegated/scheduled/workflow execution remains gated until completion.

## Verification

Proposed commands: `bun test apps/web/src/features/bots/form-state.test.ts` and `bun test apps/server/src/modules/bots/onboarding.test.ts`. Test draft return, negative/repeated/stale replies, forged consent, actor isolation and meaningful-change invalidation. An approved real-harness conversation plus explicit user confirmation is required; a fixture cannot stand in for this. Browser checks cover keyboard, refresh and nontechnical setup wording.

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

**Status: Done.** Readiness needs a real (non-fixture) completed answer at the current version, a persisted satisfaction question and an explicit answer tied to it; 'not yet' keeps it unready; reconfiguration resets; verified with real Claude Code in the UI.

Evidence: apps/server/src/modules/chat/chat.integration.test.ts; v1-workflows.integration.test.ts.

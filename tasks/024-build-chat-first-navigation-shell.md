# RFC-024: Build chat-first navigation shell

- **Module:** Bots and teams
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-020](020-implement-versioned-bot-configuration.md), [RFC-022](022-provision-one-personal-chief-per-user.md), [RFC-023](023-create-bot-teams-and-sidebar-groups.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Provide the referenced sidebar with the personal chief first, grouped bots, chat entry points and routine/settings navigation.

## Non-goals

No canvas layout, unrelated dashboard redesign or fake unread/run counts.

## Source anchors and planned changes

- `apps/web/src/routes/_auth/route.tsx`
- `apps/web/src/routes/_auth/dashboard.tsx`
- `apps/web/src/features/navigation/ (new)`
- `packages/ui/src/styles/globals.css (only if needed)`

## Contract and implementation steps

1. Compose responsive navigation with the personal chief first and authorized workspace/group lists. Follow the user-approved main-view reference: persistent left sidebar with workspace selector, search and bot rows with status/recency previews; selected-bot header with model/capability controls; spacious conversation region and bottom-anchored composer. Keep Automations and Apps secondary. Collapse the sidebar on narrow screens without losing selected-bot context. The reference does not add voice controls, native window chrome, host-computer access or per-action approval requirements. Permit setup-required bots to open an onboarding conversation; the shell must not require completed RFC-021 or onboarding becomes cyclic.
2. Use RFC-071's shared attention projection for working, needs-input/blocked and unread-result indicators. Provide bot search/filter and an authorized origin link, with consistent read-state semantics and selection across navigation. Loading, unavailable and empty states need a clear next action.
3. Add routes only for implemented features, including the dedicated attention kanban when RFC-072 lands. Make collapse/search/focus behavior accessible; do not implement a separate attention store or require the finished board to ship this shell.

## Acceptance criteria

- [ ] The signed-in user's chief remains first and private bots are absent for other users.
- [ ] Navigation works on narrow/wide screens with keyboard access and visible focus.
- [ ] In a fixture with 20 visible bots, the user can find a named bot, distinguish working/needs-attention/unread results and open the correct owned task. Indicators agree with RFC-071 after reload; no private counts or invented statistics appear.

## Verification

Proposed command: `bun test apps/web/src/features/navigation/selection.test.ts` for pure selection logic. Approved browser checks at narrow/wide viewports and with empty/error lists.

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

**Status: Done.** Chat-first sidebar with groups, search, attention badge, chief pinned, not-ready indicators.

Evidence: apps/web/src/features/chat/sidebar.tsx.

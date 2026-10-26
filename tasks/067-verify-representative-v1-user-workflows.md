# RFC-067: Verify representative v1 user workflows

- **Module:** Operations and release
- **Status:** Review; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-028](028-add-safe-markdown-composition-and-rendering.md), [RFC-032](032-mention-and-route-to-visible-bots.md), [RFC-033](033-add-message-reactions.md), [RFC-035](035-build-team-read-only-snapshot-viewer.md), [RFC-037](037-aggregate-bounded-specialist-work.md), [RFC-041](041-show-routine-run-history-and-outcomes.md), [RFC-045](045-prove-source-to-briefing-context-flow.md), [RFC-050](050-configure-bounded-decision-routing.md), [RFC-053](053-configure-and-inspect-bot-hooks.md), [RFC-058](058-inspect-correct-and-forget-memories.md), [RFC-061](061-learn-reusable-procedures-after-tasks.md), [RFC-063](063-apply-only-explicitly-approved-versions.md), [RFC-021](021-build-bot-onboarding-and-settings.md), [RFC-072](072-build-user-attention-kanban.md), [RFC-073](073-configure-resources-through-any-bot-chat.md), [RFC-078](078-provide-secure-takeover-and-hand-back.md), [RFC-082](082-inspect-workflow-progress-and-repair-paths.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Check the promised user outcomes with deterministic fixtures and approved manual user journeys.

## Non-goals

No live financial trades, unauthorized security testing, real newsletter audience sends or exact-text LLM assertions.

## Source anchors and planned changes

- `apps/server/src/test-support/v1-workflows.test.ts (new)`
- `docs/verification/v1-workflows.md`

## Contract and implementation steps

1. Implement the connected journeys below for nontechnical users, retaining daily briefing/newsletter/financial/code/security use cases as synthetic or explicitly authorized tasks. Verify the transition between screens/services, not just each form in isolation.
2. Exercise form and non-chief-chat configuration through the same services, real conversation plus satisfaction onboarding, visual workspaces, attention kanban, repair-and-return, learning/routines, visual workflows and browser/computer takeover.
3. Assert observable contracts and provenance with deterministic fixtures, then record separately approved real user/harness/browser/computer walkthroughs with accessibility checks. A fixture cannot prove onboarding readiness or runtime compatibility. Keep direct bot chat and advanced settings available without requiring technical jargon in the primary flow.

## Acceptance criteria

- [ ] Onboarding requires an actual selected-harness response followed by an explicit positive user satisfaction response. No/adjust/retest/reload/stale approval and A-ready/B-unready paths pass; forms and chat through a non-chief bot preserve the same validation/authority.
- [ ] Sidebar/activity/kanban agree on owned pending work. Delegated and scheduled tasks show attribution, completed/missing/uncertain portions and durable results. Repair returns to the same work without auto-retrying uncertain effects; workspace moves never share private cards or create chiefs.
- [ ] Task→instruction→routine and incorrect-result→knowledge-correction→later-session journeys pass, alongside rich chat/snapshots, visual workflow branches, browser/profile operation and isolated desktop takeover. Both real browser and computer-use evidence are required, with no new separate artifact-management product.

## Connected journey matrix

| Journey | Required evidence |
| --- | --- |
| First useful bot | Open personal chief or create specialist; configure in plain language; complete account setup and return; exchange initial messages through the real harness; bot asks satisfaction; No keeps setup open; explicit Yes completes only the tested actor/bot setup. |
| Configuration by either route | Create/edit an authorized bot or routine in forms and via a non-chief bot; inspect the same draft/diff; reject/refine/save with version checks; a new bot still needs its own onboarding. |
| Chief → specialists → attention | One specialist succeeds, one blocks; identify who did what from chat and kanban; open durable output, repair the blocker, return, and explicitly choose a safe next attempt. No duplicate cards or re-execution on view. |
| Stable task → repeat | Review a successful task, inspect/save its procedure, choose Make recurring, understand schedule/context/accounts/result destination, activate when ready, and reopen the first occurrence's result. |
| Wrong fact → improved context | Follow recorded provenance from a result to memory/instruction, correct or forget it, return to the original result, and verify a later session uses corrected context. History and snapshots remain unchanged. |
| Visual workflow | Build a bot-task/condition graph visually or with accessible forms; publish a version, run both branch scenarios, inspect skipped/partial steps and repair through the same attention item. |
| Browser and computer work | Select a dedicated or same-user-shared browser profile, run an authorized website task and a separate desktop task, handle secure login takeover, hand back explicitly and inspect results. Credentials never enter retained chat/screenshots/learning. |
| Find and share work | In 20 bots, locate a specialist and pending owned work; use Markdown/files/server references/mentions/threads/reactions; publish an entire read-only snapshot and verify private later messages/resources are not shared. |

## Verification

Proposed command: `bun test apps/server/src/test-support/v1-workflows.test.ts`. Manual browser/E2E/model/desktop checks require approval; record fixture-only versus real validation for every matrix row. Check keyboard navigation, comprehensible labels, draft/error recovery and no required technical knowledge in the main setup path. Missing real onboarding or either execution backend is a release blocker.

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

**Status: Review.** Four representative journeys pass with a scripted model through the real pipeline; real-model evidence only for Claude Code, Laya and Chromium.

Evidence: docs/verification/v1-workflows.md.

## Completion update (2026-10-23)

**Status: Done.** Owner scoped real-model evidence to Claude. Recorded end-to-end demo with claude-haiku-5-5 through the real UI and server (docs/demo/zetta-v1-claude-haiku-5-5-demo.mp4): bot configuration, chat, memory recalled in a new chat with a 'used notes' receipt, onboarding, Email/X source setup form, a two-step workflow built, checked, saved and run (Portuguese result), canvas view.

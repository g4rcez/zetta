# RFC-078: Provide secure takeover and hand-back

- **Module:** Browser and computer use
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-027](027-render-streaming-history-and-reconnect-states.md), [RFC-071](071-define-common-in-app-attention-state.md), [RFC-076](076-expose-isolated-browser-automation-tools.md), [RFC-077](077-run-isolated-computer-use-sessions.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Let a user resolve login/MFA or other required human steps and return control to the same bot task safely.

## Non-goals

No passwords/codes in normal chat, CAPTCHA bypass, concurrent bot/human input or automatic replay after uncertain actions.

## Source anchors and planned changes

- `apps/server/src/modules/computer/takeover.ts (new)`
- `apps/web/src/features/computer/takeover.tsx (new)`
- `apps/server/src/modules/attention/ (producer binding)`

## Contract and implementation steps

1. Issue short-lived owner/session/run-bound takeover access and a needs-input item. Suspend bot input and screen observation before exposing the secure view; suppress credential-entry capture from logs, stored screenshots, transcripts and learning.
2. Provide explicit take over / hand back / cancel controls and reconnection rules; each action rechecks authorization and exclusive input ownership. Explain what the bot completed and what it is waiting for.
3. After explicit hand-back, verify current page/desktop state and target access before continuing supported work. Otherwise retain results and offer a deliberate new attempt with repeated-effect warnings. Resolve attention only when the underlying blocker is cleared.

## Acceptance criteria

- [ ] Only the owning user can view/control the session; stolen/expired links, revoked sessions and two-controller races fail safely.
- [ ] Synthetic passwords/MFA values never appear in retained frames, events, chat, memory or snapshots, and bot input is suspended during takeover.
- [ ] The user can complete a human step and return to the same task; disconnect/cancel/unsupported resume produces an honest recoverable state, not silent re-execution.

## Verification

Proposed command: `bun test apps/server/src/modules/computer/takeover.test.ts`. Owner/token/lease/redaction fixtures plus approved browser/desktop takeover walkthrough; real secret values are never test inputs.

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

**Status: Done.** Takeover/hand-back with compare-and-swap, epoch guard against stale agent turns, login hand-off.

Evidence: apps/server/src/modules/computer/computer.test.ts.

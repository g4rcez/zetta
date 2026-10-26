# RFC-077: Run isolated computer-use sessions

- **Module:** Browser and computer use
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-006](006-define-harness-contract-and-fixture-adapter.md), [RFC-008](008-implement-isolated-process-supervision.md), [RFC-013](013-implement-pi-execution-adapter.md), [RFC-074](074-select-required-browser-and-computer-backends.md), [RFC-030](030-reference-authorized-server-files.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Provide a real isolated desktop/computer-use session for authorized bot work, not just a browser tab.

## Non-goals

No unrestricted server-host desktop, cross-user screen viewing, shared clipboard leakage or assumed support from a chat-only harness.

## Source anchors and planned changes

- `apps/server/src/modules/computer/sessions.ts (new)`
- `apps/server/src/modules/computer/tools.ts (new)`
- `apps/server/src/services.ts (lifecycle wiring)`

## Contract and implementation steps

1. Implement the approved backend session lifecycle with initiating user, run, workspace filesystem, screen/input lease and explicit limits. Do not confuse the visual bot workspace with this execution filesystem.
2. Expose verified screenshot/interaction capabilities through the host-tool registry with safe output classification and exclusive automation input ownership. Mount only authorized files and clear scoped clipboard/temporary data.
3. Cancel/timeout/revoke stops input and terminates or safely suspends the owned session according to the backend contract. Restart records uncertain effects rather than repeating desktop actions.

## Acceptance criteria

- [ ] A bot completes an approved synthetic desktop task and returns a safe result with session/run attribution.
- [ ] A cannot view/control B screen, clipboard, files or processes; concurrent controllers cannot acquire the same input lease.
- [ ] Cancellation/revocation ends bot control, cleanup follows the accepted retention policy, and missing backend support blocks readiness rather than falling back to the host.

## Verification

Proposed command: `bun test apps/server/src/modules/computer/sessions.test.ts`. Lifecycle/lease fixtures; approved isolated desktop probes verify real input, screen access denial, clipboard separation and cleanup. No real personal desktop use.

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

**Status: Done.** Desktop computer use works through Cua Spaces: each user+profile gets its own local Linux container Space (never the host or relay computers), screenshot/click/type/key/scroll/launch/read, per-turn bot tool zetta:desktop, takeover with epoch, UI in Studio > Computer. Verified with fakes and on a real Cua Space (two users, two containers, PNG screenshot, accessibility read, Space deleted) and in the browser UI.

Evidence: apps/server/src/modules/computer/desktop.ts, desktop.test.ts (ZETTA_DESKTOP_TEST=1); apps/web/src/features/studio/desktop.tsx.

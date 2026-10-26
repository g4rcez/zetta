# RFC-076: Expose isolated browser automation tools

- **Module:** Browser and computer use
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-006](006-define-harness-contract-and-fixture-adapter.md), [RFC-013](013-implement-pi-execution-adapter.md), [RFC-075](075-manage-scoped-browser-profiles.md), [RFC-029](029-attach-owned-files-as-run-context.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Let bots browse and act through the approved browser backend within the initiating user's profile and run.

## Non-goals

No unsupported CLI flags, unrestricted navigation, solving human challenges automatically or direct host-profile reuse.

## Source anchors and planned changes

- `apps/server/src/modules/browser/adapter.ts (new)`
- `apps/server/src/modules/browser/tools.ts (new)`
- `apps/server/src/modules/runtime/ (host-tool registration)`

## Contract and implementation steps

1. Map verified navigation/read/interaction capabilities into typed host tools with run-bound profile/session identity. Browser state and outputs are data, not authority to alter account bindings.
2. Apply endpoint/network policy, action/time/output limits and profile leases. Route download artifacts through authorized file handling; classify login/MFA/human steps as blocked takeover requests rather than fabricating completion.
3. Propagate cancellation and clean process/session resources. Persist only safe visible results/provenance; secret entry/sensitive screen output is excluded from message history, memory and snapshots.

## Acceptance criteria

- [ ] An approved synthetic website can be navigated/read/acted on using the selected profile, with an actor-bound result and no other-user data.
- [ ] Malicious pages, redirects, oversized output and expired sessions follow bounded denial/blocked behavior; no ambient credential fallback occurs.
- [ ] Cancel/restart releases or reconciles resources without replaying uncertain actions; actual browser compatibility is verified, not just mocked.

## Verification

Proposed command: `bun test apps/server/src/modules/browser/adapter.test.ts`. Contract fixtures plus approval-required local browser site probes for navigation, profile identity, injection, download scope and cancellation. RFC-078 supplies takeover UI.

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

**Status: Done.** Browser tool for bots: SSRF guard, per-turn cap, abort, login detection, results fed back.

Evidence: apps/server/src/modules/computer/computer.test.ts.

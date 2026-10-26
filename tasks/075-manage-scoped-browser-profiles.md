# RFC-075: Manage scoped browser profiles

- **Module:** Browser and computer use
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-007](007-store-user-owned-connection-references.md), [RFC-008](008-implement-isolated-process-supervision.md), [RFC-074](074-select-required-browser-and-computer-backends.md), [RFC-020](020-implement-versioned-bot-configuration.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Persist browser profiles that are dedicated to a bot or explicitly shared among one user's bots, with exclusive ownership during use.

## Non-goals

No cross-user sharing, workspace-implied sharing, export of cookies into chat or copying native host login profiles.

## Source anchors and planned changes

- `packages/db/src/schema/browser-profiles.ts (new)`
- `apps/server/src/modules/browser/profiles.ts (new)`
- `apps/web/src/features/bots/browser-profile-settings.tsx (new)`

## Contract and implementation steps

1. Store owner, profile identifier, selected sharing mode, bot binding and version; keep cookies/login material inside the approved isolated secret-bearing storage. Profile selection is user-specific, not a credential on the shared bot definition.
2. Implement create/select/reset/revoke with explicit destructive-reset confirmation and secure cleanup. Enforce leases/locking so two bots cannot concurrently manipulate one shared login session without an accepted serialization policy.
3. Expose simple dedicated/shared profile options and connection health. Recheck access before use and release locks on cancellation; a crash with an uncertain active process requires reconciliation before reusing the profile.

## Acceptance criteria

- [ ] A bot can use its dedicated profile or an explicitly shared profile of the same user; B cannot list/open/share/reset A profiles even for the same bot.
- [ ] Concurrent use is serialized and stale leases cannot let an old and new owner control the profile together.
- [ ] Restart preserves intended login state; revoke/reset prevents future use and does not publish cookies, downloads or secrets in logs/transcripts.

## Verification

Proposed command: `bun test apps/server/src/modules/browser/profiles.test.ts`. A/B bindings, explicit sharing, reset, stale lease and revoke fixtures; approved real filesystem/process profile checks prove isolation and cleanup.

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

**Status: Done.** Per-user browser profiles (dedicated per bot or shared), reset, revoke, serialized actions; in Docker mode one container per user+profile with only that profile directory mounted.

Evidence: apps/server/src/modules/computer/profiles.integration.test.ts.

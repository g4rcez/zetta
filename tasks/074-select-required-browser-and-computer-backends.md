# RFC-074: Select required browser and computer backends

- **Module:** Browser and computer use
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Research / decision
- **Dependencies:** [RFC-002](002-prove-multi-user-execution-isolation.md), [RFC-012](012-research-six-harness-compatibility.md)
- **Size target:** One focused session; about 2–5 product files plus tests. Split with the coordinator if an integration needs a larger change.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and prerequisite completion records. Paths marked new are proposals. Product scope is confirmed; specific schemas/APIs/auth changes, dependencies, infrastructure and live checks still require the repository's approval gates.

## Goal

Choose evidence-backed browser automation and computer-use implementations for required v1 functionality.

## Non-goals

No question about whether browser/computer use belongs in v1; no automatic install, paid sandbox provisioning or unrestricted host desktop access.

## Source anchors and planned changes

- `docs/decisions/browser-computer.md (new)`
- `apps/server/Dockerfile`
- `docker-compose.yml`
- `docs/decisions/harness-compatibility.md (from RFC-012)`

## Contract and implementation steps

1. Verify agent-browser and candidate CUA/native harness computer-use protocols, versions, licenses and supported deployment OS. Record browser and full desktop capabilities separately; browser-only success cannot satisfy both requirements.
2. Define actor-owned profile/desktop/session boundaries, process/network containment, downloads/clipboard/screenshot handling, native input locking and lifecycle ownership. Specify whether a common host-tool bridge supplies capabilities to each harness.
3. Design secure human login/MFA takeover and hand-back, screen streaming access, cancellation/restart and resource limits. Get approval for required infrastructure/dependencies; record probe recipes and unsupported combinations.

## Acceptance criteria

- [ ] Accepted evidence names one viable browser path and one viable computer-use path with exact protocol/version and all-six-harness exposure strategy or explicit blockers.
- [ ] Design excludes cross-user profiles/screens/clipboard and host-desktop fallback, including shared-bot and concurrent-run cases.
- [ ] Login secrecy, screenshot suppression/redaction, connection revocation, temporary resources and persistence/recovery are defined for downstream RFCs.

## Verification

Review first-party docs at https://agent-browser.dev/ and https://github.com/trycua/cua plus verified harness docs; record versions/dates. Approved synthetic runtime probes only; missing backend or dependency approval blocks required v1 delivery.

Use synthetic data and record exact results. Do not run builds, full suites, E2E, provider calls or infrastructure checks without approval. Fixture success is not real compatibility proof.

## Definition of done

- [ ] All acceptance criteria and the [shared definition of done](README.md#shared-definition-of-done) have evidence; research decisions include source/version and approval references.
- [ ] The next worker has concrete exported contracts, safe failure/recovery behavior and authorized UI entry/return points; no private credentials or content appear in logs/fixtures.
- [ ] Focused checks, changed paths, unresolved blockers and newly unblocked tasks are recorded below. Required functionality cannot be silently deferred when an integration is unavailable.

## Small-model handoff and stop rules

Implement only this RFC after prerequisite acceptance. Reuse the existing run, actor, configuration and attention contracts. Stop for undocumented provider behavior, new dependency/infrastructure needs or a change to confirmed product behavior. Do not broaden scope or mark unverified runtime behavior done.

## Completion record

Bounded [074a research](074a-research-isolated-browser-computer-backends.md) delivered the [browser/computer candidate ADR](../docs/decisions/browser-computer.md), supported by36 pinned public-source receipts. [Independent review](../docs/verification/reviews/browser-074a-review.md) gives CLEAR/APPROVE with no blocker for accepting the proposal. Coordinator accepts agent-browser plus standalone MIT Cua Driver in a separate LinuxX11 GUI sandbox, with separately licensed Xvnc/noVNC/websockify candidate viewing. FSL Spaces remains unselected. This is planning acceptance only.

The exact release/image/dependency manifest, LinuxXvnc pairing, encrypted persistent profile storage/restore, actual egress enforcement, takeover observation/input barrier and all-six-harness bounded image delivery remain unverified. RFC006 currently supplies JSON-string callbacks, not certified multimodal transport; Cursor provenance remains unverified. No backend/service/model/account/container/VM was started by this research. Existing006/007/008/010 authority must supply run/secret/lease boundaries; no native host-desktop fallback. Parent074 and the required v1 browser/computer capability stay incomplete.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Backend selection decided and shipped: Playwright/Docker Chromium for web, Cua Spaces (local Linux container Spaces via the cua CLI's MCP server) for desktop; ADR amended.

Evidence: docs/decisions/browser-computer.md.

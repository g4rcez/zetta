# Foundation readiness review

2026-10-22. Status: **WATCH**. Recommendation: accept the supported no-network research boundary as RFC-006's prerequisite after correcting the parent handoff. Do not infer operational harness, credential, browser, desktop or network readiness. This review changes no task status.

## Findings

**M1 - Required handoff correction before dependency advancement.** `tasks/002-prove-multi-user-execution-isolation.md:60` still lists full deadline, resource enforcement and restart/interruption proof as pending; `docs/decisions/execution-isolation.md:62` still lists CPU/PID and bounded recovery as pending. Both omit the current 002d worker/coordinator receipts. `tasks/005-enforce-actor-and-resource-access-boundaries.md:59` likewise predates the actual browser journey and the current final-review blockers. A next worker reading these authoritative handoffs receives a different prerequisite contract from the current evidence. Minimal fix: integrate the accepted 002c/d evidence and exact limits, then state which capability remains blocked and which next contract is accepted. For005, retain RFC-004 as a real dependency until its fixes and final review pass; replace the open-ended requirement for all future resource consumers with explicit consumer obligations.

No blocking correctness or containment defect was found in the new synthetic002d scope. Its actual evidence supports the described acknowledged-launch and held-before-submission scenarios. This is not approval to reuse its helper as the production supervisor.

**WATCH - Unknown CREATE is not durable production recovery.** `scripts/execution-isolation-recovery.ts:44` accepts a trusted caller's `settled` boolean, and `:92` holds a creator before submission before receiving its eventual completion. It does not recover a permanently lost daemon receipt or restart the entire coordinating controller. The verification record discloses this accurately. Minimal production requirement: persist attempt identity and uncertain operation state before submission; admit no replacement/replay until the daemon outcome is reconciled. Preserve quarantine and failed cleanup when that cannot be established. This remains RFC-008/010 acceptance work, not a reason to block a pure typed fixture contract.

## Decision

### Motivation

RFC-006 must define the contract used by later supervisors and adapters. Requiring operational native-harness proof before that contract exists creates a cycle:006 is a prerequisite of012, and real adapters require008/010/012. The same issue arises if005 waits for every future domain consumer, because007 and later domains require005 first.

### Constraints

RFC-002 is explicitly a research/decision task: its goal is to choose a verifiable boundary; its verification calls for design review and approved synthetic probes, with unproved production execution blocked. Its third criterion delegates concrete browser/computer backend questions to074. `tasks/plan.md:98` permits an accepted supported research design while a required integration remains blocked. Conversely, `tasks/README.md` requires accepted prerequisite handoffs and does not permit unsupported capabilities to become successful fixtures. The root index remains the status authority.

### Options and trade-offs

| Option                                                                                                      | Consequence                                                                           | Verdict   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- |
| Hold002 until every native/network/browser integration works                                                | Requires consumers before their own prerequisite contracts; obscures actual next work | Reject    |
| Declare operational isolation complete from the13 synthetic cases                                           | Overstates credential, egress, native state and takeover evidence                     | Reject    |
| Accept002's supported no-network design/probe boundary; keep capability-specific operational gates explicit | Allows pure006 while every real execution path must still prove its required boundary | Recommend |

### Recommendation

The coordinator can accept RFC-002 as a **research/design prerequisite for RFC-006 only**, after M1 is corrected and the acceptance wording expressly identifies the supported scope. This does not complete the broader aggregate isolation objective or permit networked/native execution. No acceptance criterion should be deleted or weakened; map each criterion to its actual research artifact and retain every operational proof in its owning task/release gate.

| RFC-002 criterion                                                                     | Supported conclusion                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accepted design excludes foreign/host filesystem, environment and shared native state | The selected Linux boundary excludes host authority and selects actor-owned state with exclusive leases. Synthetic mounted-state/process/environment controls pass. Actual native login/session behavior remains a per-harness gate. |
| Approved adversarial plan; unproved containment blocks real runs                      | The plan and13-case receipts cover the implemented no-network fixture, including previous containment cases, lifecycle/resource enforcement and bounded recovery. Uncertain daemon outcomes remain quarantined.                      |
| Deployment requirements and questions for074                                          | CLI, browser, desktop, profile, clipboard, takeover and secret-observation requirements are recorded. A viable concrete browser/desktop backend is still required in074-078 and at release.                                          |

RFC-006 may now define actor/run/attempt-bound input/events/tools, explicit unsupported capabilities, terminal-once behavior, bounded errors and cancellation using synthetic fixtures. It must import no production probe, invoke no real CLI/provider, and emulate no unsupported capability as success. Native transport, credential and egress fields are requirements/capability declarations until their implementations are accepted.

## RFC-005 handoff boundary

The current access module exports the intended prerequisite: fresh session/membership resolution, frozen issued actors and owner/nested-owner guards. The focused tests cover anonymous/unenrolled denial, forged actors, A/B/admin-private substitution and nested-parent substitution. Route tests additionally reject request-supplied ownership fields and untrusted origins. The coordinator's actual browser record supports removed-session denial and enrollment repair; it does not prove arbitrary future resource routes.

After RFC-004's current signup/privacy and bounded-client fixes pass their actual regressions and independent review,005 can be accepted as this **server actor/ownership contract**. It should not wait for resources that depend on it to exist. Future consumers must resolve a fresh actor per request/dispatch, scope database predicates by that actor, verify nested relations, reject owner/body substitution and prove their own allow/deny matrix before their task is accepted. `requireOwned` is not automatic protection for a missing query predicate or cached actor.

This is conditional acceptance guidance, not a fresh final identity approval. The inspected final identity report is BLOCK while the signup defect is under correction. Accepted origins/cookie behavior must remain supported by the final004 handoff, including the configured desktop origin; source fixtures are not native transport proof.

## Next-work readiness

| Work                                   | Readiness after coordinator integration                                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 006 typed harness contract and fixture | Ready once002's supported research acceptance is recorded;003 is already accepted.                                                                                                                                |
| 007 connection storage                 | Still requires accepted004/005 plus a concrete approved secret-store/schema strategy (`tasks/007-store-user-owned-connection-references.md:30`).002 research acceptance supplies no secret persistence mechanism. |
| 008 supervisor /010 recovery           | Require their listed prerequisites and actual owned-process lifecycle/uncertain-operation proofs. Synthetic research helpers are not production implementations.                                                  |
| 013-018 real adapters                  | Require accepted contracts/supervisor/connections, version-matched protocols, actual native state/host-tool/cancel/resume proof and approved enforceable egress. All six remain required.                         |
| 074-078 browser/computer/takeover      | Concrete viable backends, per-user profile/desktop/input boundaries and credential-entry observation suppression remain required.                                                                                 |
| Release                                | All real integration, privacy/recovery and connected user-journey gates remain required. No fixture or research status passes release.                                                                            |

## Verification and evidence limits

Independently executed:

```sh
bun --no-env-file test scripts/execution-isolation-probe.test.ts scripts/execution-isolation-recovery.test.ts apps/server/src/modules/identity/access.test.ts
```

20 pass,0 fail,123 assertions across three files, exit0. These are offline tests; no Docker, database, server or browser was started by this reviewer. The coordinator's13-case Docker receipt, cleanup:true and actual source identities were inspected in `local evidence`; the worker's first failed PID run and corrected final run remain recorded in `docs/verification/execution-isolation-002d.md`. Existing strict-TypeScript receipts were inspected, not rerun. No source mutation experiment was performed under the assigned read-only scope.

Reviewed correctness, security, architecture, readability and bounded-resource behavior using the code-review-and-quality skill. Existing probe `any` types, local endpoint coupling and incidental source assertions remain maintenance limits; they are not new002d containment findings and should not be copied into production boundaries. No package install, Git mutation or source edit was performed.

Source SHA256 at review:

```text
f7b0c11a276b3d0ccd9e782edb04605dd1cf597ff4c382a2203bda1da25bc58c scripts/execution-isolation-probe.ts
f14576ac2f3f8d107d349fc23aa2691002f4fa6a71da9266a1a5a41bf974d32d scripts/execution-isolation-recovery.ts
e698d0352534eb788ecfd539ce00ef2b4bb928bcc639dbd3ad73c8a9f3fbb403 scripts/fixtures/execution-isolation-payload.ts
0bbebd5d68bc6edae39491bd8cf952bc9762b57b22d1d3f57d15d7f65d018e40 apps/server/src/modules/identity/access.ts
```

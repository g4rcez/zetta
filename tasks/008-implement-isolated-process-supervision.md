# RFC-008: Implement isolated process supervision

- **Module:** Execution runtime
- **Status:** Review; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-002](002-prove-multi-user-execution-isolation.md), [RFC-006](006-define-harness-contract-and-fixture-adapter.md), [RFC-007](007-store-user-owned-connection-references.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Own the lifecycle of one isolated CLI process with bounded input/output and deterministic cleanup.

## Non-goals

No queue, real provider login, arbitrary user shell interpolation or automatic installation.

## Source anchors and planned changes

- `apps/server/src/modules/runtime/process-supervisor.ts (new)`
- `apps/server/src/modules/runtime/isolation.ts (new)`

## Contract and implementation steps

1. Implement the approved containment primitive; pass explicit executable/argv, scoped home/workdir and allowlisted environment.
2. Bound output bytes, time, concurrent resources and child-process trees; support cancellation and termination escalation.
3. Clean temporary credential/context files and reconcile orphan processes on supervisor startup; expose structured failure reasons.

## Acceptance criteria

- [ ] Synthetic process cannot access B/host resources according to RFC-002 probes; unsupported isolation prevents launch.
- [ ] Timeout/cancel/output overflow ends the owned process tree and closes descriptors without touching unrelated processes.
- [ ] No raw credential or full untrusted command text enters logs; failure cleanup runs on spawn, parse and exit errors.

## Verification

Proposed command: `bun test apps/server/src/modules/runtime/process-supervisor.test.ts` for pure lifecycle fixtures. Approved subprocess/containment probes are separate and mandatory before production acceptance.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Do not leave mock success paths in production code.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Accepted [008a design](008a-design-isolated-launcher.md) selects the closed [linux-systemd-v1 launcher boundary](../docs/decisions/runtime-supervisor.md) after [independent CLEAR/APPROVE review](../docs/verification/reviews/runtime-008a-review.md). Source-only child008b implements the typed LaunchSpec and fixed no-network fixture recipe. It imports no probe as a production supervisor, starts no service and supplies no operational or native readiness.

The accepted006 contract plus007 crypto/schema storage contracts supply this secret-free source boundary. Complete007 credential dispatch resolution still requires008/010 integration; requiring it before the secret-free launcher would introduce a cycle. All parent008 acceptance boxes remain open until actual process-tree, crash/deadline, output, cleanup and ownership scenarios pass on the selected provisioned Linux control plane. Existing macOS Docker/Colima access does not establish systemd/runner/helper support. Networked/native and GUI execution require their own actual proofs. No deployment, install or real account/provider call follows from design acceptance.

008b1's writable bootstrap and008c's pure journal are accepted with independently repeated tests and CLEAR reviews. [008c](008c-define-resource-journal-transitions.md) records121 tests/235 assertions plus strict/nine pure checks; it persists no files and issues no daemon effects.008d1 file/codec and008d2 actual Linux descriptor capability are accepted. The user explicitly approved the dedicated VM and its exact pinned tool installation; [host receipt](../docs/operations/runtime-test-host-install.md) records completed installation/isolation.

[008d3b layout/snapshot](008d3b-implement-journal-layout-and-snapshot.md) and [008d3b1 actual Linux profile](008d3b1-verify-linux-journal-profile.md) are accepted: busy rename regression corrected; actual ext4 admission/tmpfs denial, descriptor/namespace readback and exact cleanup passed. [008d3c owner/store composition](008d3c-compose-journal-owner-and-store.md) is in progress. Actual store crash cuts, authenticated resource facts and operational systemd supervision remain separate gates; no parent008 completion is inferred.

## Completion record (2026-10-23, simplified v1 path)

**Status: Review.** Supervision implemented for both runtimes: own process group (host) or `docker kill` (container) on timeout/cancel/overflow, output cap, deadline, per-user and global concurrency limits, minimal env. In Docker mode the isolation criterion is exercised by real-container tests; in host mode (default) there is no OS isolation.

Evidence: chat/harness.ts, harness.test.ts, harness-docker.test.ts.

## Completion update (2026-10-23)

**Status: Review.** Made system-agnostic by owner request: process-tree kill uses a process group on POSIX and `taskkill /T` on Windows, Windows profile variables are passed, Linux-only journal fixtures skip elsewhere, CI matrix added (.github/workflows/ci.yml). Verified on macOS only; the first Linux and Windows CI runs are still pending.

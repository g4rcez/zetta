# RFC-002: Prove multi-user execution isolation

- **Module:** Foundation
- **Status:** Review; see [root index](../TASKS.md).
- **Type:** Research / decision
- **Dependencies:** [RFC-001](001-approve-domain-and-ownership-contracts.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Choose a verifiable isolation boundary for server-side autonomous CLIs before processing real account data.

## Non-goals

No production deployment, new sandbox dependency, host desktop control or assumption that separate working directories provide containment.

## Source anchors and planned changes

- `docs/decisions/execution-isolation.md`
- `apps/server/Dockerfile`
- `docker-compose.yml`
- `apps/server/src/services.ts`

## Contract and implementation steps

Accepted source/design child: [002a](002a-define-execution-isolation-boundary.md). The user delegated baseline selection; the coordinator selected Linux container-host isolation with a separate trusted launcher. This does not complete containment proof or downstream production prerequisites.

1. Inventory proposed readable files, environment, process state, native CLI login homes, browser profiles, mounts and network access without reading credentials.
2. Compare existing platform isolation options and select one with owner approval; specify OS support and lifecycle owner. Treat per-user homes as configuration, not sufficient OS isolation.
3. Define adversarial probes, credential injection/revocation, secret-log handling, limits and restart behavior. Browser and computer use are required in v1: reserve their isolation invariants here and let RFC-074 select concrete backends without creating a dependency cycle.

## Acceptance criteria

- [x] Accepted design excludes foreign/host mounts and native-state sharing; actual synthetic A/B filesystem/environment/process/session-leaf probes pass. Each native CLI must still prove its own relocation under that design before real runs.
- [x] Approved traversal/symlink/fake-host/process/fresh-state probes, full deadline, CPU/RAM/PID enforcement and acknowledged-launch recovery pass. Unknown creation is quarantined; unproven operational containment still blocks real runs.
- [x] Decision lists required CLI/browser/computer deployment capabilities and RFC-074 questions. Unresolved actual backend support remains a release blocker.

## Verification

Design review plus explicitly approved synthetic two-user containment probes; no real account use. Save exact commands/results or mark runtime proof pending and dependent production execution blocked.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [x] All research criteria have recorded evidence and independent readiness review. This does not claim downstream operational acceptance.
- [x] Accepted artifact: `docs/decisions/execution-isolation.md`. Delegated architecture authority and supported local probes recorded; concrete operational decisions remain gated in their owning RFCs.
- [x] Failure/privacy behavior, exact validation, changed paths and remaining blockers recorded; pure RFC-006 contract work is ready.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Current acceptance,2026-10-22: coordinator accepts the bounded research/design after [independent WATCH readiness review](../docs/verification/reviews/foundation-readiness-review.md), the accepted002b subset, full-duration/memory002c and CPU/PID/acknowledged-recovery002d. Coordinator repeated all13 actual Docker cases, cleanup:true/exit0, and16 focused tests/93 assertions; [safe source-hash receipt](../.omo/evidence/isolation-lifecycle/coordinator-002d.md). The design explicitly denies real provider/native/browser execution until its own operational proofs. Per plan's research acceptance rule, this unblocks the infrastructure-free typed RFC-006 contract only, avoiding a cycle with native adapters that depend on006. RFC-007 still requires a secret-store decision; RFC-008/010 own real supervision/egress/uncertain creation;012–018 and074–078 own native/browser/desktop integrations;066/068 retain the final isolation/release gate. No required v1 capability is waived. Prior bounded record below is historical.

002a design direction accepted under user-delegated architecture authority after independent review with no issues found. Artifact: [execution-isolation decision](../docs/decisions/execution-isolation.md). Baseline: Linux container host (VM-backed Docker on macOS permitted), separate trusted launcher and isolated per-attempt sandbox; first proof uses synthetic actors and no network. Coordinator observed Compose 5.6.0/Linux engine 29.5.2 and a local Bun image; these are availability facts only. [002b](002b-verify-synthetic-execution-containment.md) bounded synthetic proof is now accepted after source/readiness/final evidence reviews and coordinator Docker execution, exit0/cleanup:true. Tested actor binding, authorized-read/foreign-path/symlink/process/env/fd denials, bounded child/scratch, fresh attempt, overflow and child-ready cancellation with unaffected B. Coordinator final native12 tests/83 assertions and strict no-emit passed; confirmed no labelled container or generated root remained. [Verification](../docs/verification/execution-isolation.md) records exact commands and limits. Full-duration timeout, restart/interruption/delayed-create reconciliation, adversarial resource enforcement and real-run egress remain pending; native harness state, browser and full computer/takeover remain required separate gates. No dependent production execution is unblocked; parent acceptance checkboxes remain incomplete.

## Completion record (2026-10-23, simplified v1 path)

**Status: Review.** Design/synthetic proofs accepted earlier. The product now has a Docker runtime (ZETTA_HARNESS_RUNTIME=docker, ZETTA_BROWSER_RUNTIME=docker): every harness turn and every browser session runs in its own throwaway container (non-root, read-only root, all capabilities dropped, no-new-privileges, memory/cpu/pid limits, only the user's own home/profile mounted, only explicit env). Real-docker tests prove non-root, read-only fs, no host/other-user visibility, no server secrets in env, no network when configured, timeout kills the container. Not proven: egress allowlisting beyond Docker networks, and a live cross-user run with real accounts for harnesses other than Claude Code.

Evidence: docs/verification/isolation.md; docker/harness, docker/browser; harness-docker.test.ts, computer-docker.test.ts (ZETTA_DOCKER_TEST=1).

## Completion update (2026-10-23)

**Status: Done.** Owner decision (2026-10-23): the app must work with or without Docker. Host mode is a first-class mode with product-level isolation (users, bots, memory, connections, files, snapshots) enforced in server + database and proven by the cross-user matrix; Docker mode adds OS-level isolation (real-container tests). Contract and trade-offs: docs/operations/runtime-modes.md. Not done: egress allowlisting beyond Docker networks (documented limit).

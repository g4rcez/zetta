# RFC-008a: Design the isolated launcher

- **Parent:** [RFC-008](008-implement-isolated-process-supervision.md)
- **Status:** Done for bounded design; coordinator accepted independent CLEAR/APPROVE review. Implementation and provisioning were not started by this child.
- **Type:** Bounded design/research
- **Scope:** [Runtime supervisor ADR](../docs/decisions/runtime-supervisor.md), this handoff, and runtime-008a evidence.

## Goal and authorization

Provide an implementable launcher boundary for the accepted Linux isolation direction without adding another queue or treating fixture execution as native compatibility. The coordinator assigned docs-only work under continued-v1 authority. No service/container start, build/install, credential read, model/provider call, Git mutation or schema change is authorized by this child.

## Required contracts

Read and align [isolation](../docs/decisions/execution-isolation.md), [connection secrets](../docs/decisions/connection-secrets.md), [harness compatibility](../docs/decisions/harness-compatibility.md), [GUI isolation](../docs/decisions/browser-computer.md), [RFC-009](009-persist-run-lifecycle-and-idempotency.md) and [RFC-010](010-dispatch-and-recover-durable-work.md). Current runtime, standalone probe and recovery sources were inspected directly; prior reports were not treated as fresh runtime proof.

## Completion record

Design delivered and accepted on 2026-10-22 after [independent technical review](../docs/verification/reviews/runtime-008a-review.md), CLEAR/APPROVE with no blocker. It selects a separately trusted launcher with mTLS control, a strict finite LaunchSpec and local recipe expansion. Initial fixture-v1 is specified to run as non-root with network none, fixed image/executable/argv/environment, private bounded scratch and no host mounts. Only launcher-side processes hold Docker authority. These are accepted requirements, not observed running behavior. Child008b source-only spec/recipe implementation is authorized separately; no production runtime follows from this research.

The resource journal records intent before Docker operations, preserves unknown create/start/delivery outcomes, keeps terminal tombstones and permits exact-resource cleanup only after ownership and operation settlement. The selected proposed linux-systemd-v1 profile uses a fixed systemd runner as deadline owner independent of the API process. Missing capabilities deny launch before resource creation. Existing macOS Docker/Colima socket access does not supply this profile; it requires a separately provisioned Linux control plane and proof. No production cleanup or deadline guarantee is claimed here.

PostgreSQL RFC-009/010 retains sole run/attempt/claim/lease/grant authority. RFC-007 owns encryption/owner/version checks and the accepted lock order; committed single-use grants precede plaintext delivery. Accepted storage contracts permit a secret-free launcher proof while full resolution waits for integration, avoiding a dependency cycle or second grant engine.

The egress comparison prefers a trusted provider-specific gateway where native protocols support it, with destination-restricted CONNECT as a separately reviewed fallback. It records DNS/private-network and firewall requirements, internal-bridge host reachability, IP-only and TLS limitations, and the difference between iptables and nftables. Network none proves no provider compatibility. Future GUI raw channels stay with a separate broker/sandbox so harness code cannot bypass credential-entry pause.

## Design acceptance evidence

[Evidence report and review matrix](../.omo/evidence/runtime-008a/report.md) lists the exact source inventory, current hashes, primary documents fetched on 2026-10-22, static link-check invocation and captured output. It distinguishes observed code, cited upstream facts, proposed contracts and unexecuted acceptance scenarios.

Design criteria covered: authenticated transport; closed bounded recipe; non-root/no host authority; durable resource journal and conservative uncertainty; deadline/output/cancel/tree lifecycle; startup reconciliation; single DB dispatch/grant owner; source-supported egress/TLS comparison; separate GUI broker; concrete native/image/toolchain provisioning blockers.

No behavioral tests, live containment, mTLS handshake, systemd unit, real native harness, provider gateway or credential delivery were run. Link/hash checks are documentation integrity evidence only. This child cannot mark the parent RFC-008 operationally complete.

## Next bounded worker and stop rule

After coordinator review, implement only strict LaunchSpec/recipe expansion and resource-journal transitions with injected Docker/control I/O and focused negative fixtures. No Docker start, service, database or credential implementation in that slice. Return explicit invalid-field/fence/duplicate/deadline/pending-operation/corrupt-journal/terminal-replay evidence.

Then separately provision and prove the authenticated Linux fixture launcher before RFC-009/010 dispatch integration. Native Linux images/auth/session/protocol proofs, enforced provider egress, private profile storage and GUI broker/takeover remain distinct acceptance gates. Root TASKS and parent acceptance remain coordinator-owned.

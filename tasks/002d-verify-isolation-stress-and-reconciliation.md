# RFC-002d: Verify isolation stress and reconciliation

Parent: [RFC-002](002-prove-multi-user-execution-isolation.md). Status: review; bounded worker runtime evidence passes, coordinator acceptance pending.

## Scope and authority

The v1 continuation and coordinator assignment authorize extending the standalone synthetic probe. The coordinator also approved a separate recovery module/test to keep lifecycle recovery out of the original containment runner. Existing local pinned Bun image, fixed local daemon, non-root, network=none, private namespaces and original resource limits remain in force. No app runtime, accounts, installs, image pulls, DB resources, production integration or Git changes are involved.

## Completion record

Changed: existing probe and payload; new `scripts/execution-isolation-recovery.ts` and `.test.ts`; this record and [verification](../docs/verification/execution-isolation-002d.md). Existing probe tests are unchanged. The probe now invokes the recovery scenario after all original seven cases and the new resource cases.

- CPU: two finite 2.5-second compute children under the inspected one-CPU quota. Require actual cgroup `cpu.max` = 100000/100000, increased `nr_throttled`, >500000 microseconds CPU consumed and successful child exits. B remains healthy.
- PIDs: one finite shell attempts 40 children, each sleeping three seconds. Require a successful ready marker, nonzero exhaustion exit, increased cgroup `pids.events max`, and current PID count no greater than32. B remains healthy.
- Recovery: fsync a closed journal before creating A. A separate launcher creates/inspects/starts A, acknowledges completion, then is killed with SIGKILL, SIGINT or SIGTERM. A must still be running; a new reconciliation call reloads the journal and removes only the matching name/UUID label/container ID. B remains healthy after each case.
- Delayed creation: hold a live creator before submission, prove reconciliation throws `PendingCreate` before filesystem/Docker work, release the creator, then observe actual CREATE/start completion, kill the launcher, and reconcile from the persisted journal. This proves quarantine and later receipt handling. It does **not** prove cleanup after an arbitrary Docker daemon request with a permanently lost outcome; that remains unresolved and retains the journal with cleanup:false.

Actual full probe passed13 scenarios with exit0/cleanup:true. Focused tests passed16/93 assertions, strict TypeScript including exactOptionalPropertyTypes passed. A post-check found zero probe-labelled containers and zero generated roots. Full commands, exact output, failure receipt, hashes and limitations are linked in the verification record.

First runtime attempt preserved the original seven cases and passed CPU stress, but the direct repeated Bun.spawn PID mechanism stalled at saturation and hit the watchdog. Its cleanup result was false; it is recorded as failure, never passing evidence. Inspection found no probe-labelled container remained. Only its exact owned generated root was removed. The revised finite shell pressure mechanism then passed the complete run.

No production execution is unblocked. Required remaining gates include enforceable real egress, native harness/session/login isolation, secret storage and distinct browser/computer/takeover evidence. Unknown CREATE outcome remains a quarantine condition, not a successful cleanup claim. Parent RFC-002/root status stays incomplete.

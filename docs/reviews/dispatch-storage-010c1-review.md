# Independent review: dispatch storage010c1

Verdict: **CLEAR for the bounded storage design**. No blocking findings. Root acceptance remains separate. Reviewed2026-10-22 against the author's confirmed frozen hashes, independently recomputed immediately before this artifact. No schema, migration, service or operational behavior is approved as implemented.

## Criteria and direct source evidence

| Criterion | Finding and source |
| --- | --- |
| Existing FK feasibility | CLEAR. [ADR](../decisions/dispatch-storage.md) lines45–107 uses the actual `run_attempts(id,run_id,owner_user_id)` unique triple, adds the corresponding claims triple for grant identity and binds claim installation/policy to the proposed capacity unique pair. [Runs schema](../../packages/db/src/schema/runs.ts) defines the target; [connections schema](../../packages/db/src/schema/connections.ts) has only the credential pair PK and parent owner/kind triple. Fixture columns must both be NULL; no nonexistent credential owner-triple FK or hidden007 migration is assumed. The future two-FK extension is feasible but separately gated. |
| Closed scalar and canonical contract | CLEAR. ADR25–31,82–126 bounds counters, finite millisecond time, identifiers, text byte size and state pairs. It distinguishes SQL JSON-array/regex shape from exact decoder, digest, scalar correspondence and trusted provenance. [Dispatch contract](../../apps/server/src/modules/runtime/dispatch-contract.ts) confirms17-field canonical encoding, fixture null credentials, activate1/input65537 and bounded copied input descriptors. [Launch spec](../../apps/server/src/modules/runtime/launch-spec.ts) confirms the documented hashed tuple and the distinction between historical parse and fresh admission. Missing storage decoder is explicitly assigned later, not invented as an export. |
| Grant transition alignment | CLEAR. ADR99–101 matches [parse/transitionDispatchGrant](../../apps/server/src/modules/runtime/dispatch-state.ts): pending admits once, cancellation after issue retains spent state, expiry never erases issuance, uncertain may retain NULL issue time, and late acknowledgement keeps uncertainty without timestamp fabrication. Exact acknowledgement replay preserves revision/time at the service. SQL guards intentionally enforce monotonic storage, while the service must still use the accepted fact transition boundary; arbitrary scalar-valid SQL is not an executable command. |
| Immutable identities and tombstones | CLEAR. ADR128–143 requires immutable identities/canonical text/expiry, exact revision increment, sticky receipt/prepare/cancel/cleanup/release, constrained initial rows and DELETE/TRUNCATE rejection. Unique attempt/action/sequence and retained rows prevent reminting a spent slot. Resource pending-operation settlement remains trusted service work; clearing a pair is not itself proof of settlement. Trigger implementation and direct SQL negative controls remain future proof obligations. |
| Capacity and safe release | CLEAR. ADR145–161 counts the full SQL aggregate of every unreleased claim; no1024 truncation, terminal/expiry omission or decrementing counter. Only occupancy increases acquire capacity; uncommitted releases conservatively remain counted. Release needs actual locked terminal run/current attempt, no pending operation and either durable never-submitted history or authenticated exact-resource removal. Empty inventory, timeout and unknown response cannot release. This correctly separates resource cleanup from unresolved external effects. |
| Commit loss and no replay | CLEAR. ADR124–126,163 requires canonical equality and same operation/action identity repair. Prepare/action intent commits before I/O. Unknown commit performs no I/O; subsequent lookup returns status rather than replay permission. The explicit pending pair preserves unknown resource operations, while uncertain grant tombstones preserve unknown external delivery. |
| Existing trigger order | CLEAR within stated service discipline. [Custom009 migration](../../packages/db/run-test-migrations/20261022180711_runs_constraints/migration.sql) locks parent run during attempt update/delete and rechecks current attempt deferred under run→attempt locks. ADR157 requires run/attempt before claim/grant and forbids first invoking applyRunTransition after claim/grant. New custom guards are row-local and add no hidden reverse acquisition. Claim FK checks target the already locked attempt/capacity; grant FK checks target the already locked claim. Actual integrated lock proof is still required. |
| Existing identity boundary | CLEAR for initial single-owner fixture dispatch only. [Enrollment](../../apps/server/src/modules/identity/enrollment.ts)61–72,138–140 has installation→admin membership→auth account→subject membership; [replacement](../../apps/server/src/modules/identity/admin-lifecycle.ts)116–121 uses installation→sorted accounts→sorted memberships. These are not a globally uniform multi-member order. Initial fixture dispatch holds one owner membership and never then seeks installation/admin/account locks, so it does not introduce020's two-member inversion. Identity cancellation/release integration must never acquire capacity after that prelude; releases require no capacity. Any multi-owner/bot/native extension needs a fresh unified-order review, not inheritance of this CLEAR. |
| Scope and future gates | CLEAR. ADR165–183 and [task](../../tasks/010c1-design-dispatch-storage.md) separate offline feature-only generation, actual guarded SQL proof and later service/race proof. Backend cancellation cannot forge009 owner_requested: the missing backend lifecycle extension is explicit. ExecutionAuthority, real settlement, canonical provenance, native credentials, operational launcher and worker remain unimplemented gates. |

## Important interpretation for next author

The opening source summary calls attempt lease identity immutable. The existing trigger directly protects id/run/owner/generation/created_at and assigned lease_id, and forbids lease-expiry regression; it does not independently freeze every other attempt timestamp. Therefore010 service must continue checking the claimed-at/claim-created-at correspondence and accepted lifecycle transitions. Do not infer a new009 claimed-at SQL guard from this review or alter009 incidentally.

Scalar checks may admit a structurally coherent release or grant payload that lacks real backend authority. The ADR explicitly reserves that authority to the later service/launcher boundary. S1–S5 cannot replace R1–R5 or operational cleanup proof. Tombstone TRUNCATE guards do not replace a least-privilege runtime role or prevent a privileged operator from changing DDL.

## Review invocation and binary observables

Read-only inspection used `cat`, bounded `sed` and `rg` over the files below; no tests/DB/container/VM/install/provider/Git mutation. A mistargeted optional membership glob returned no files; actual identity order was inspected directly in enrollment.ts and admin-lifecycle.ts instead. Source review, not a fake ORM test, is the acceptance evidence here.

Final freeze verification invocation: Python3 `hashlib.sha256(Path(path).read_bytes()).hexdigest()` for each file below, with exact equality assertions for the author's ADR and task hashes. Both assertions passed. All referenced local source files exist and were read. External documentation links in the proposal were not independently re-researched; verdict relies on local accepted contracts and marks future PostgreSQL/generator behavior as requiring its actual proof.

## Reviewed source hashes

```text
f957fbab6ac2451d0cf22e921a572b086e7935dc0689a7c4297c03706cdc4f3f  docs/decisions/dispatch-storage.md
0656846cc418d29e841d80b11b56cbd33b6cf70c793846acba97b8fcceda77ce  tasks/010c1-design-dispatch-storage.md
72b8d47db055ee5ce4d293ca0d3599902d9cb0a8f7fa8bc480739d567d37d5eb  docs/decisions/durable-dispatch.md
6d9846465de925f10951d793582f657afc3ac514a88ca19470089e036e5a297d  tasks/010a-design-durable-dispatch.md
f4b1cd76b58d046b4ac5db8e0c536c17f6e89dd4f968c9d939a51f9d5a0fc7b5  tasks/010b1-define-dispatch-action-contract.md
8b99e2ae6c12a44fc5589938a70df724a341e704714f22ab7e72e9f1faa5f62f  apps/server/src/modules/runtime/dispatch-contract.ts
7841a8ea2f032f572ea43224cb079fe5a3b0a33fcccb21531c4d71b71c8982c1  apps/server/src/modules/runtime/dispatch-state.ts
9816acd2da62b0a9345bcdf599f343b94a7a28e2179e465985fe7f1add2715b8  apps/server/src/modules/runtime/launch-spec.ts
dfa9c25404e7d1779b6b3b30e9fde561420fd2afa38a917ab43a82307b3f0c87  apps/server/src/modules/runtime/runs.ts
0ca7e3d62a5776022ef890c70e362b56dab6f25b7cd937e333573f73ae4cf84d  packages/db/src/schema/runs.ts
3bd54ce01d5d5936c1cf70541e977c13a09baf897bd4b49d9b33a5b6f9ee7ea3  packages/db/src/schema/connections.ts
35f95e21e74a777dbe3527ae4d0ae9aa545e2c639ee8a3292ea08d84f8b0d785  packages/db/run-test-migrations/20261022180711_runs_constraints/migration.sql
0cbc222f81eecf28679d4a0dd8b33366992c335d6112cab8ba7f821309c71b24  apps/server/src/modules/identity/enrollment.ts
092a726a4f74f6573f5744d2e237a1b065a88332b522193534661714bbbeb052  apps/server/src/modules/identity/admin-lifecycle.ts
522c1df4994bc7861e4e45daf9129beb7f49545d34f0ec4cd615b70e11e645ba  packages/db/drizzle.run-test.config.ts
```

Changes to the frozen ADR/task require a review delta before this verdict is reused. No runtime test, SQL enforcement, capacity race, authority issuance or native execution success is claimed.

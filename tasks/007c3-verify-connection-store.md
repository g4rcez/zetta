# RFC-007c3: Actual PostgreSQL connection metadata-store proof

Status: done for scoped metadata-store database proof; coordinator independently repeated all19scenarios/cleanup without warnings, session31806 exit0, and accepts independent CLEAR/APPROVE review. Parent RFC-007 remains incomplete.

## Accepted dependencies and scope

Final acceptance: [independent review](../docs/verification/reviews/connection-007c3-review.md), no blockers; coordinator final source-bound receipt. Historical session38813 passed behavior but emitted a shared-client setup warning; only initial actor-fixture queries were made sequential, with real race clients remaining independent. Final proof SHA256 `ca687bed6a733db4ec285e75fec3fdb40f8507b8a1695b34166dc4cdc9e1d931`. No warning suppression or production-service fix was involved.

Consumes [007c2 store contract](007c2-implement-connection-store.md), coordinator-accepted 007c2a parser-buffer fixes/trusted third nonce-source argument, [007c1 schema](007c1-define-connection-storage-schema.md) and independently repeated [007c1a disposable proof](007c1a-verify-connection-schema.md). No service, crypto, schema, migration, identity helper, production composition, environment schema, dependency or provider changes.

Owned files are `apps/server/src/modules/connections/store.integration.ts`, `store-proof-cases.ts`, `store-proof-races.ts`, additive fixed `connection-store` launcher/test mode, this task and evidence. Each new proof module is below 250 nonblank/noncomment lines. The existing launcher remains the only infrastructure owner, with no new target selector.

Approved actual command: `bash scripts/verify-identity-auth.sh connection-store`. It reuses only the dedicated fresh `zetta-identity-tests` tmpfs PostgreSQL 18 service and immutable pinned migration helper. Existing ownership, loopback, tmpfs, local-image-only and environment guard behavior stays intact. No real credentials or accounts.

## Proof contract and limits

The entry point is inert on import. It validates the existing disposable target before importing the driver/helper; a 120-second whole-proof deadline covers imports, scenarios and awaited close. After the two pinned migrations reserve verified clients, new sockets/listeners/DNS/HTTP/fetch/Bun network APIs are blocked with a sticky attempt counter. This instrumentation does not cover the earlier guarded setup or claim an OS firewall.

Three synthetic users/memberships, including the installation admin, are seeded in the actual database. `createIdentityAccess` uses a controlled SessionSource and actual `createMembershipLookup` to issue genuine actors. This is a service-plus-database proof, not HTTP/sign-in evidence. Retaining issued actors across removal deliberately tests the store's fresh database membership check. Concurrent mutations always use distinct reserved `firstDb`/`secondDb`; the third owner client controls barriers and observes `pg_stat_activity`/`pg_blocking_pids`. There is no concurrent transaction multiplexing on one PoolClient.

Eleven metadata/startup/fault scenarios and eight concurrency/time scenarios cover:

- Actual create/list/replace/revoke; caller bytes unchanged; exact safe DTO key allowlist; synthetic encrypted row opened directly by test crypto; retained versions/nonces and exactly one current-row join. No production resolver or grant is added or certified.
- Original committed receipts after later replacement/revocation and after original DB-clock expiry; all create/replace/revoke semantic argument changes and operation-type substitutions conflict; same operation UUID under another owner is independent.
- Foreign owner/admin and forged actors denied; removed membership denies replay/list/replace/revoke; owner-bound keyset pagination visits owned IDs once and rejects foreign/tampered cursors.
- Fresh factory against the same database preserves references with the same key; wrong/malformed key, absent/corrupt/inconsistent sentinel, and nonempty missing-sentinel reinitialization fail closed. This is factory reconstruction, not full process/host restart or backup restore.
- Trusted deterministic nonce source: two collisions followed by success on exactly attempt three, then three-collision exhaustion with unchanged row/counter counts; old ciphertext deletion retains the nonce tombstone.
- Narrow temporary credential-insert trigger forces transaction failure; all connection/version/nonce/receipt/count writes roll back. Trigger/function are removed before subsequent cases.
- A transaction wrapper throws only after the real database commit. An independent reserved client sees committed state, and retry with the identical operation ID returns the stored result without more writes. This tests the acknowledgment fault boundary, not a real TCP drop.
- Signed integer revision/version overflow denied using explicitly synthetic boundary fixtures. The version-overflow fixture deliberately sets the pointer boundary directly and is not claimed a healthy historical state.
- Concurrent empty-store startup observes the advisory-lock wait and produces one sentinel/count/nonce. Concurrent duplicate create observes membership ordering and produces exactly one connection/version/receipt and only two nonces/count including sentinel.
- Replacement and revoke each win one observed lock ordering; their competing stale-revision mutation conflicts. Mutation-before-removal and removal-before-mutation are both observed with database blockers and fresh membership readback.
- The capacity test injects count 999,999 into an already verified running store, then races independent owners: exactly one final encryption succeeds and the other gets key-capacity; count becomes one million. This tests row-lock/counter behavior, not a million-entry ledger or startup consistency at that scale.
- Expiry test derives time from PostgreSQL, observes a mutation waiting on the key-check row while expiry is still in the future, observes database time cross the deadline while the lock remains held, then releases it and requires invalid-input with unchanged counts. Readiness is driven by observed locks/time, never fixed sleeps.

Scenario output contains only fixed PASS names/counts or fixed failure phases. Errors are privately reduced to expected safe codes; assertion/driver errors, SQL, buffers, labels and keys are never serialized. All scenarios use synthetic rows. Reset truncates the explicit five connection tables; final success cleanup truncates the exact 13 known tables together, without CASCADE or calling the obsolete eight-table cleanup. Pending race promises are settled after barrier release even on a barrier failure. The owned tmpfs launcher teardown is the final cleanup boundary.

## Preparation completion record

Evidence: `local evidence` and `commands.json`.

- `bash -n scripts/verify-identity-auth.sh`: exit 0.
- `bun --no-env-file test scripts/verify-identity-auth.test.ts apps/server/src/test-support/identity-proof-target.test.ts apps/server/src/test-support/identity-test-target.test.ts`: 31 pass, 0 fail, 948 assertions. Includes actual inert store-entry import and unsafe-target denial without IO plus fixed shell dispatch/cleanup/refusal fixtures. No database claim.
- Scoped TypeScript strict/exactOptionalPropertyTypes/noUncheckedIndexedAccess/noUnused/noFallthrough: exit 0; exact invocation in `scoped-strict-types.log`.
- LSP tool reports no diagnostics for the three proof modules; automatic hook reports Biome unavailable, so no Biome claim.
- `source-hashes.json` records new source plus consumed store/keys/contract/crypto hashes; `size-check.json` records proof-file line counts.
- Coordinator review refinements integrated before actual execution: DB-clock-derived replay expiry, proof that expiry is still future after observed lock wait, explicit successful removal result, pending-race settlement in cleanup, exact duplicate-create nonce/count accounting.

## Actual execution record

Coordinator reviewed the source and explicitly authorized `bash scripts/verify-identity-auth.sh connection-store` against the dedicated fresh tmpfs PostgreSQL 18 service. The first actual run passed **19/19 named scenarios**, final fixture clearing, reserved-client shutdown, zero new-network attempts and launcher teardown, exit 0. No proof/service correction was needed during execution. `postgres-run-1.log` is the complete safe capture; `actual-scenarios.json` maps each case name to its exact invocation, passing observable and absolute artifact path.

`cleanup-readback.json` independently confirms the dedicated project's container, network and volume listings are empty (each command exit 0). The resource owner did not use volume removal or prune. Source remained frozen during execution; a post-run hash comparison matched every file in the preparation manifest before this documentation update. `actual-source-hashes.json` records executed proof/store/crypto/helper/schema/target/Compose inputs. Final shell syntax and scoped strict diagnostics exit 0; launcher/target tests rerun at 31 pass / 948 assertions.

These results establish the bounded service/database behaviors and their explicitly synthetic fault boundaries described above. They do not establish HTTP credential setup, full process/host restart, backup restore, real network acknowledgment loss, native profile handling, readiness invalidation or durable dispatch/decryption integration.

Remaining acceptance: independent coordinator repeat/review. No active dedicated resources remain. Parent RFC-007 stays incomplete until its downstream acceptance conditions are met.

### Sequential setup correction after independent repeat

The coordinator's independent run (session 38813) passed 19 scenarios and cleanup but observed the pg 8.23 deprecation category for concurrent queries on a single client during actor fixture setup. Its historical tool receipt is retained by the coordinator. The setup used `Promise.all` for three membership lookups sharing `firstDb`; it now awaits actor issuance sequentially. No warnings are suppressed, and the actual race cases still use independent reserved clients.

The corrected source passed the focused launcher/target tests (31/948), strict TypeScript and shell syntax, then the full authorized PostgreSQL proof again: **19 checks, exit 0**, complete fixture/client/container/network cleanup, with no warning/deprecation text in the combined log. Evidence: `postgres-run-2-sequential.log`, `sequential-log-validation.json`, `sequential-cleanup-readback.json`, `sequential-source-hashes.json`, and `sequential-setup-*.log` under the same evidence root. The corrected proof SHA-256 is `ca687bed6a733db4ec285e75fec3fdb40f8507b8a1695b34166dc4cdc9e1d931`. Independent coordinator repeat of this corrected source remains pending.

# RFC-010c3b1: Implement explicit fixture capacity bootstrap

Status: assigned source implementation, 2026-10-22. Governing decisions: docs/decisions/dispatch-claim-store.md and dispatch-claim-store-implementation.md,010c3b0 reviewed by coordinator. Source-only; actual combined-lineage proof remains separate.

Own NEW apps/server/src/modules/runtime/dispatch-capacity.ts and dispatch-capacity.test.ts only, plus this task and unique evidence. Preserve other dirty work. No schema/migration/adapter/launcher/DB/VM/Git/API/worker/effect changes.

Implement bootstrapFixtureCapacity(db,trustedPolicy): strict trusted policy copy, one READ COMMITTED transaction, singleton1 INSERT ON CONFLICT DO NOTHING then exact SELECT FOR UPDATE and compatible immutable2/1 row readback. Preserve first timestamp; absent/incompatible/malformed/uncertain results use the documented closed errors. No implicit bootstrap in consumers; no image column or image persistence claim.

Expose only narrowly necessary pure capacity-row/count decoding and bounded occupancy checking helpers for later reservation. Count canonical decimal strings with BigInt and signed-int64 limit; require owner<=total and count all unreleased claims without expiry/status exclusions. No authority issuer, arbitrary transaction callback or caller-supplied SQL. Follow existing database/Drizzle/source patterns and250nonblanklines per module; report boundary conflicts before expanding scope.

Read covering existing policy/schema tests first. Verify meaningful malformed/count/exhaustion/configuration/strict-input controls and construction behavior; installed strict diagnostics. Mock transactions are not evidence of SQL serialization. Record source hashes/tests/CLEAR/limitations; freeze for coordinator review. Future actual fresh18-table proof must test absent/replay/mismatch/two-client bootstrap and count/tombstone occupancy. No actual run in this child.

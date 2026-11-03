# RFC-010c1: Design dispatch storage

Status: design accepted after [independent CLEAR review](../docs/reviews/dispatch-storage-010c1-review.md) and coordinator source inspection,2026-10-22. Parent010 remains incomplete. Own only this task, the new [dispatch storage ADR](../docs/decisions/dispatch-storage.md) and unique evidence. The next schema implementation requires its own bounded assignment.

Prerequisites: accepted [010a dispatch design](010a-design-durable-dispatch.md), [010b1 pure contract](010b1-define-dispatch-action-contract.md), existing009 run/attempt schema and007 connection schema. Actual existing exports/constraints were inspected directly.

## Proposed outcome

Exactly three tables: immutable singleton capacity policy, one claim per attempt with immutable spec/lease/resource identity, and retained once-admission grants. Claims add explicit pending-operation and cleanup fact pairs. Logical status and lease expiry derive from existing locked009 rows; no duplicate renewable lease or caller terminal/settled boolean exists. All unreleased claims count regardless of expiry, logical termination or unknown resource state.

Fixture grants require NULL connection/version and add no invalid credential FK. A later native extension must review its two-FK binding against the actual existing credential pair PK and parent connection owner/kind unique key. Backend cancellation reasons stay in claims; current009 owner_requested is not forged. Operational backend cancellation/terminal integration remains a separate reviewed gate.

The ADR defines every column, null/time/status check, composite FK/unique index, immutable/monotonic/tombstone trigger, exact canonical byte obligation, lock order and release provenance boundary. SQL constraints enforce structural storage facts; later real service/launcher proof establishes authority and cleanup truth. ExecutionAuthority remains unimplemented.

## Next bounded gates

1. Independent design review and coordinator acceptance, including pending/cleanup columns, FK feasibility, reason mapping and the separation between row checks and service provenance.
2. Separately assigned010c2 schema-only source with a feature-only offline Drizzle generator and explicitly approved custom guard migration. No existing007/009 schema changes or migration rewrites by assumption.
3. Separately reviewed guarded actual PostgreSQL proof source and exact target authorization. The ADR's S1..S5 and R1..R5 distinguish schema enforcement from later service/race proof; neither is claimed complete here.

Evidence, inspected source hashes and design checks.

No schema/code, migration generation/apply, database, service, container, environment, credential, provider, package or Git mutation occurred. Only the owned documents/evidence were written. No runtime resources were created; there is no operational cleanup claim.

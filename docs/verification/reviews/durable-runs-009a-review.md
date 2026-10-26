# RFC-009a independent design review

codeQualityStatus: CLEAR
recommendation: APPROVE for the proposed bounded foundation
blockers: []
Reviewed 2026-10-22. Design acceptance only; no schema, store, worker or operational acceptance.

## Findings by severity

CRITICAL: none. HIGH: none. MEDIUM: none remaining. LOW: none.

Resolved during review: the original crash/expiry row unconditionally selected interrupted, conflicting with committed cancellation precedence. Fresh reading of ADR line82 now confirms cancelled/uncertain when cancellation committed first, otherwise interrupted/uncertain, with immutable earlier terminal outcome. The coordinator also clarified deferred-trigger coverage and evaluation requirements at line22.

## Architecture and authority

Two records are sufficient for immutable logical request identity/input plus appendable execution attempts. Composite owner/run keys, owner-scoped request uniqueness, immutable fields/lease identity and bounded generation/revision are coherent. Exact canonical UTF-8 comparison avoids a digest-only equality assumption or unnecessary MAC/key management. Generated IDs and time stay out of semantic comparison; identical requests return current DTO without a second attempt. Private canonical snapshot captures restart input rather than rereading mutable bot context.

The 96 KiB snapshot, 65,536-byte prompt and 64 KiB terminal result limits are feasible bounded contracts. Implementations must check the encoded snapshot size (escaping may expand input), the existing harness string bound and result/event limits, and reject oversize content rather than silently truncate. Finite versioned tuple encoding and explicit nulls are a small serialization responsibility, not a generic configuration framework.

Fixture-only initial submissions with no connections/resume avoid inventing nonexistent bot/conversation/configuration authorization. Stored opaque IDs do not prove resource ownership/readiness. Public producers remain gated on RFC020/025 queries and dispatch reauthorization. No structural actor casting, raw credentials, native profiles or extra queue engine are introduced.

Cancellation linearizes at the run row. Earlier completion stays terminal; earlier cancellation controls eventual terminal status while preserving effect uncertainty. Logical terminal status is distinct from confirmed stop/cleanup; unresolved resources retain capacity/quarantine. A later reconciliation may settle effect/stop facts without rewriting terminal outcome/time. No retry API or automatic reactivation on expired lease is authorized.

Membership→run→attempt owner operations and future membership→sorted connections→run→attempt→grant are compatible provided no path acquires connection locks after run locks. The optional global capacity gate is explicitly an RFC010 proof requirement, not silently implemented here. No network call spans a transaction. RFC010 remains sole claim/lease/grant owner; 011/025 handle event retention and source materialization, without blocking the fixture-only foundation.

## Schema feasibility and next boundary

Independently inspected installed Drizzle1.0.0-rc.4 declarations: select.d.ts:609 exposes for(strength,config), select.types.d.ts:69-75 supports skipLocked with the stated exclusion, and session.d.ts:19 supports read committed. This confirms API availability only.

Official [PostgreSQL18 CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html) supports deferred constraint triggers as AFTER ROW and documents that WHEN is evaluated immediately. The proposed existence invariant is feasible with reviewed custom SQL, not an assumed generated Drizzle trigger API.

009b must review actual SQL and its privilege/concurrency assumptions before acceptance: cover run insert/current-generation change and attempt deletion/identity changes, reread the current run inside the deferred function, and prove commit-time failure for a missing current attempt. Test both insertion order and concurrent pointer-change/deletion, plus immutable-field, lease reassignment and composite-owner negatives. Triggers do not substitute for row-lock discipline or production-role restrictions. Preserve restrictive deletion and no cascade.

The next bounded work is schema/closed transition contract and offline state-table tests, then an approved disposable PG proof for real constraints and races. 009c/d must prove same-owner deduplication/other-owner independence, unchanged immutable snapshots, cancel/completion and cancel/crash ordering, safe ambiguous-commit repair and fresh authorized reads. Do not start a claim loop, producer framework or native integration in this slice.

## Evidence and skill perspective

Read actual ADR/task, existing harness/access/store contracts and design evidence. The evidence checker performs document/link/token checks only; no behavior confidence is attributed to those counts. No product code changed, so code tests/LSP were not run. No DB/service/installation/Git action occurred.

Previously loaded programming, TypeScript, remove-ai-slops and code-review perspectives applied. No unnecessary abstraction, unsafe type escape or needless normalization is proposed. Canonical private input and boundary validation have concrete durability/idempotency purposes. Future tests must assert transitions and actual constraints rather than matching ADR prose. No style blocker manufactured.

Source-bound SHA256:
- docs/decisions/durable-runs.md: a2fe0c5319435cfe9f209570b87db945c7ea2f208fbe2911d9d23212b3626e43
- tasks/009a-design-run-and-attempt-storage.md: 17c048ef83508095c0a2c752a9d4d485afdf4b6cc7c470f759d281cd7c9ce3b3

Earlier writer source manifests predate coordinator clarifications; these hashes identify the design actually approved by this review. Parent009 remains incomplete until implementation and real proof pass.


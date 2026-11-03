# RFC-010c3b0: Detail private claim-store implementation boundary

Status: design preparation assigned, 2026-10-22. Existing accepted dispatch-claim-store decision and010c3a codecs govern. Source-only private reservation implementation may be prepared while actual provenance/role gates finish; no worker or external effect can be enabled.

Own only this task, NEW docs/decisions/dispatch-claim-store-implementation.md and unique evidence. No product/schema/adapter/launcher/DB/VM/provider/install/Git changes.

Inspect actual existing codecs, state/rows,009 transition primitive, schema and accepted decision; propose at most five cohesive source/test paths for010c3b. Bind exact names bootstrapFixtureCapacity/createFixtureClaimStore/reserveFixture/getOwned/cancelUnsubmittedOwned and their closed DTO/errors. Describe capacity-before-membership/run/attempt lock order, complete eligibility/provenance/policy/input comparison, fresh clock after observed waits, exact replay/unknown commit and tombstone occupancy.

Resolve the private transaction-lifetime authority boundary before implementation: factory-local WeakSet/metadata/scope, exact transaction and operation, immediate mutation recheck and finally invalidation. No exported issuer accepts arbitrary rows/transactions, no user callback or token return. Give a meaningful way to verify dead-scope rejection without exposing a minting seam; identify any narrowly pure verifier export and why it grants no actual service authority. Keep actual transactions the authority; no process-local ticket replacing stored provenance.

Specify atomic owner cancellation using the accepted009 cancelled_before_admission transition and locked absence of grants/prepare/receipt/pending/submission facts. If the complete service cannot fit five modules honestly, split into named capacity/bootstrap and reservation/cancellation slices with explicit dependencies and no interim public authority. Include exact future actual race/rollback/replay/capacity/removal cases and current role/provenance limitations. Root reviews this concrete boundary then assigns source; no extra user confirmation is implied for this approved v1 work.

## Frozen proposal

Prepared `docs/decisions/dispatch-claim-store-implementation.md`; no product/schema/DB/launcher edits. Root reviewed the current proposal and accepted its direction; implementation awaits separately registered children. Proposed010c3b1 is exactly dispatch-capacity.ts/test.ts;010c3b2 reserve/read is four files;010c3b3 cancellation is four files including store composition. No interim public authority or fake cancellation stub.

The proposal fixes closed API/DTO/errors, capacity2/1 counting of every unreleased row, historical original-operation repair, unknown-commit semantics, fresh post-lock clock and exact existing codecs. Factory-private registry/metadata/checkpoints plus inactive-scope verification in the real callback finally provide dead-scope control without exported issuer or callback seam. The only proposed pure matcher confers no service authority. Capacity has no image column; image/version mapping remains pinned trusted composition, claims compare stored image/spec/digests.

Existing009 cancellation may produce run-only intent; initial claim cancellation returns requires_reconciliation without repair. A separately registered transaction-aware cancellation-routing integration is required before exposing both APIs together or enabling a worker, with explicit actual interaction/contention tests. Run provenance actual lineage, real role/retention/deployment confinement and removed-owner safety integration remain distinct gates. The20-case structural permission proposal or accepted pure state/codec tests do not complete those gates.

Design validation: inspected actual source exports/locks/guards, checked every local decision link exists, captured source hash manifest and document hash. Evidence `local evidence`. No tests or actual transaction behavior are claimed by this design-only slice.

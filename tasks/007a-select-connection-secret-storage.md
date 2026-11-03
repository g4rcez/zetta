# RFC-007a: Select connection secret storage

Coordinator acceptance,2026-10-22: the selected architecture is accepted for bounded007b crypto and007c owned storage planning after [independent WATCH review](../docs/verification/reviews/connection-secrets-review.md), no design blocker. The ADR now defines complete operation-specific MAC arrays covering provider/label/expiry, canonical absent/expiry encoding and create replay before ID generation. Earlier phrase-marker checks are housekeeping history, not semantic/security acceptance; behavioral implementation proofs remain required. No grant engine is approved in007:008/010 own that integration. Parent007 remains incomplete.

- **Parent:** [RFC-007](007-store-user-owned-connection-references.md)
- **Type:** Research / architecture decision only
- **Status:** Review — recommendation selected under delegated architecture authority; implementation remains pending.
- **Dependencies:** [ownership](../docs/decisions/ownership.md), [execution isolation](../docs/decisions/execution-isolation.md), [RFC-005](005-enforce-actor-and-resource-access-boundaries.md)

## Scope and outcome

Read [task rules](README.md), [plan](plan.md), parent RFC and direct contracts. Produce [connection-secrets decision](../docs/decisions/connection-secrets.md). No schema, service, environment, manifest, generated file, account or native profile change is included.

Selected recommendation: AES-256-GCM through existing `node:crypto`, a deployment-owned 32-byte key, versioned authenticated ciphertext in PostgreSQL, immutable owner/connection/kind/version AAD, owner-scoped metadata DTOs and dispatch-only resolution. API-key blobs and private native state have separate contracts. The decision fixes byte limits, nonce retention, idempotency receipts, key startup validation, grant/revoke ordering, failure behavior and operator recovery boundaries.

## Acceptance criteria

- [x] Concrete recommendation uses the existing stack and distinguishes API-key envelopes from native profile state.
- [x] Logical types, lengths, version/idempotency semantics, fresh authorization and revoke/lease ordering are specified without SQL implementation.
- [x] Missing/wrong keys, corruption, ownership substitution, uncertain writes and restart/recovery limits are specified with a disposable synthetic proof plan.
- [x] Source anchors and relative links resolve; primary crypto/runtime/database references and remaining gates are recorded.

These checks mean the research artifact is complete; they do not mark parent RFC-007 or any runtime scenario complete.

## Completion record

Status: review. Architecture selection uses the coordinator's delegated decision authority and preserves confirmed ownership/product policy. Changed deliverables: this file and `docs/decisions/connection-secrets.md` only, plus safe research evidence in the active attempt directory.

Evidence: decision review receipt. That receipt records the exact document-check invocation, binary observables and artifact paths. No crypto snippet, database/service/model/account call, install, migration or native profile operation was run. No web feature is claimed, so this research has no browser functionality claim.

Next consumer: coordinator accepts the decision, then splits RFC-007 into bounded crypto, storage/mutation and dispatch integration tasks before assigning product edits. Native state and real credential delivery remain gated by their own accepted isolation/harness contracts. Stop on unreviewed schema/API/environment changes, unsupported crypto behavior, inconsistent membership locking or any proposed ambient credential fallback. Parent RFC-007 acceptance remains pending actual implementation and evidence.

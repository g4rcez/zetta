# RFC-007 secret-store design review

Date: 2026-10-22. Verdict: **WATCH**. `codeQualityStatus: WATCH`; `recommendation: APPROVE` for architecture selection and bounded implementation planning only. `blockers: []`. No crypto, storage, native-profile or dispatch implementation is approved as working by this review.

## Scope and evidence

Read the complete new/untracked `docs/decisions/connection-secrets.md`, `tasks/007a-select-connection-secret-storage.md`, and `tasks/007-store-user-owned-connection-references.md`; their scoped git diff is empty because they are untracked, not because they have no content. Read accepted ownership and execution-isolation decisions, actual `apps/server/src/modules/identity/access.ts`, RFC-008/010 dependencies, and `local evidence`.

Independently inspected the earlier research receipt, script and JSON under `local evidence`. `shasum -a 256` confirmed ADR `24761dff44b55cd27551a0613462399549314ef842c38ac386ae47ce2fd1157b` and task007a `48200e78260d4630d901a7e5fc0b9e74a86a91ba6bd6afbed6686da18a20381c` match that receipt. Marker booleans were not accepted as security evidence.

Opened official [Node crypto](https://nodejs.org/api/crypto.html) and [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html) references independently. The former supports authenticated finalization/tag handling; the latter supports transaction-held conflicting row locks. Neither proves installed Bun compatibility or the future transaction implementation. No keys, database/server processes, accounts, installations or product-code changes were made. Tests/typecheck/browser/security scan: N/A to this prose design review; no runtime success claimed.

## Findings by severity

### CRITICAL

None found in the design scope.

### HIGH

None found in the design scope.

### MEDIUM

**M1 — specify the complete idempotency request encoding before storage implementation.** `docs/decisions/connection-secrets.md:52` requires exact request matching but lists only owner/type/target/revision/secret in the MAC array. The create and replace signatures at line46 also accept provider, label and/or expiry. The word “including” allows these fields but does not define their encoding, absent-value representation, or the create target before a server-generated ID exists. An implementer copying only the listed fields could accept the same operation ID with changed expiry or label and return the original receipt. This is an underspecified contract, not evidence of a shipped bug. In 007c define a versioned operation-specific array covering every semantically effective input; represent omitted expiry explicitly, normalize timestamps once at the boundary, and do not include a newly generated create ID in replay comparison. Test identical replay and one-field changes including expiry/provider/label.

**M2 — research phrase checks are useless semantic tests.** `local evidence` through line21 pin prose/constant fragments. They remain green if the ADR negates its security statements and fail for harmless rewording. Both skill perspectives reject this pattern. Keep hashes and link-existence checks as artifact housekeeping; retire phrase checks as acceptance evidence and use direct review plus later behavioral crypto/storage tests. The research receipt explicitly disclaims runtime proof, so this is MEDIUM rather than a misleading runtime-success blocker.

### LOW

None requiring action beyond the implementation boundaries below.

## Accepted design properties and limits

- The 32-byte service-only key, explicit 12-byte fresh nonce, 16-byte GCM tag, authenticated finalization before byte release, bounded envelope and fixed-domain owner/connection/kind/version AAD form a coherent design. Canonical key parsing and ciphertext parsing belong at their actual untrusted boundaries, without repeated normalization inside typed helpers.
- Key-check startup verification, nonce retention and atomic receipt/envelope persistence address specific stated invariants. Do not introduce a separate generic vault, parser framework or lease service. Enforce the per-key write ceiling atomically in the later store; the pure crypto slice cannot claim persistent nonce uniqueness.
- Safe DTO allowlisting, owner-scoped lookup, immutable identities, pinned versions and no admin bypass match approved ownership. Existing `requireOwned` uses issued-actor identity; an internal scheduler actor cannot be constructed with a type assertion and passed through as authenticated.
- Membership-first/connection/grant locking and committed issuance as the linearization point are coherent. They explicitly permit issuance-before-revoke delivery and do not promise to recall copied bytes. Unknown commit/delivery never licenses resend. At implementation time use database wall time after lock acquisition for expiry, rather than a transaction-start timestamp that can become stale while waiting.
- Missing/wrong keys fail closed; restart/restore/rekey are honestly separate operational proofs. Raw key custody must stay outside attempt environments. No host/native OAuth import or native-profile backend is implied; unsupported native profiles must remain denied.

## Smallest safe implementation boundaries

1. **007b crypto:** bounded API-key envelope/AAD/key-config functions and synthetic behavioral tests in the installed runtime. No DB, grants, native profiles, server environment wiring or real keys. Cover wrong-key/tamper/no unauthenticated output, limits and domain/owner/version substitution. Caller-supplied randomness is only a narrow test seam. Do not add prose tests or tests that merely repeat constants.
2. **007c owned metadata/store:** explicit schema/migration review, key-check initialization, persistent nonce accounting, atomic version/revision mutation and idempotency receipts, owner-safe DTO/list/create/replace/revoke, and disposable PostgreSQL race/restart proofs. Resolve M1 here. No public plaintext resolver and no production grant engine. Authenticated membership checks must precede replay-return as well as new mutations; removed membership cannot retrieve old receipts.
3. **008/010 integration:** durable issuance, cancellation, internal run actor authority, single-use delivery and uncertainty/reconciliation. RFC-008 already depends on007, while010 depends on008: requiring full010 delivery proof to start008 would form a cycle. Accept007b/c as the prerequisite storage subset, retaining parent007's execution-resolution acceptance as pending until008/010 integration. Do not mark the whole parent complete to bypass this gate or invent temporary production grants in007.

## Skill-perspective check

Loaded `omo:programming` and `omo:remove-ai-slops` SKILL.md before judging relevance/maintainability. Applied their boundary parsing, minimal abstraction, typed authority and behavioral-test criteria. M2 violates both perspectives. No production code/tests were introduced in this scoped ADR; no deletion-only tests or production data-extraction machinery were found in it. The proposed adversarial crypto/storage tests exercise real outcomes and are appropriate; current prose marker checks do not. No cleanup implementation was performed.

Required role report copy: `local evidence`, using `currentAttemptDir` returned by `omo-agent-toolkit ulw-loop status --json`.

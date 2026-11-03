# RFC-007c3 independent proof review

codeQualityStatus: CLEAR
recommendation: APPROVE for bounded connection metadata-store database proof
blockers: []
Reviewed 2026-10-22; production dispatch/native/session integration remains outside this acceptance.

## Findings by severity

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none remaining.

Resolved during review: original store.integration.ts actor setup used Promise.all for three membership reads on the same firstDb client, producing a pg8 deprecation warning and stack in run1. Current lines61-64 issue these fixture lookups sequentially. The real races still use independent clients. Inspected current delta and warning-free postgres-run-2-sequential.log; no warning suppression or production store change was introduced. Original run1 is historical passing behavior with a warning, not a clean-log receipt.

## Actual evidence and source binding

Inspected the complete 11-case and eight-race source, integration entry, connection-proof-client, identity-proof-client lifecycle and target guards, launcher/test additions, accepted store modules, prior 63-case schema receipt and current actual evidence.

The corrected actual command was bash scripts/verify-identity-auth.sh connection-store, executed by the owning worker. postgres-run-2-sequential.log contains 19 distinct scenario PASS lines, final fixture clearing, reserved-client closure with zero new-network attempts, owned container/network teardown and EXIT_CODE 0. No warning/deprecation appears. sequential-cleanup-readback.json records exit0/empty container, network and volume inventories for the dedicated project. No prune or volume removal is used. This reviewer audited actual receipts/source and did not start a competing database. Coordinator's fresh independent repeat is separately owned and must retain its own receipt.

All entries in sequential-source-hashes.json independently match current files. Principal hashes:

- store.integration.ts: ca687bed6a733db4ec285e75fec3fdb40f8507b8a1695b34166dc4cdc9e1d931
- store-proof-cases.ts: 058481c5560cca5f7d60dd58f1bc5880f0f40fc376340b7a80b12d4baeea92dc
- store-proof-races.ts: 4db41ce5f793ce2b3a25abac2259cb7ca9d8120c0694311c03e6f7825aea3745
- store.ts: 99d19f64891647931e9971bd27dd0c5d3147e09867a1f8a702e27454886af1fa
- store-contract.ts: 5d4e67c16eef6cc9a040e9e28c55cc5a0a9bc74c37e6c98699d3a6c34c473647
- store-keys.ts: a1c4293a3a091cd4f1137c46c827a7b4a7b7f7eb5f32d6de16aad365928f00d0
- connection-proof-client.ts: 1a0e330016be449f53a037ae0b9933f5c58e3837ffd8e18b09cb4a90be515216

Initial actual-source-hashes.json identified the old setup and pre-final task markdown. Its task-only mismatch before the setup fix was accurately explained by the completion-record update. The sequential manifest supersedes executable identity for current approval.

## Assertion relevance

The scenarios perform actual service mutations and independent SQL readbacks. Create/replace/revoke assert revisions, safe metadata keys, preserved caller bytes, retained versions/nonces and one current-version join. Test-only crypto opens an actual stored envelope with owner/version-bound context; no production plaintext resolver is introduced. Original receipt replay checks exact original DTOs after later lifecycle changes and after DB-observed expiry, plus unchanged row/counter counts. Changed semantic arguments/types conflict; another owner can independently use the request UUID.

Actor tests use genuinely issued access objects with controlled session identity and real membership queries; forged/cross-owner/admin paths deny and removed membership rejects replay as well as new work. Pagination verifies exact sorted owned IDs once and rejects foreign/tampered cursors. Startup tests cover missing/corrupt/inconsistent sentinels, wrong key and nonempty reinitialization refusal.

Trusted nonce injection demonstrates exactly three calls on success-after-two-collisions and three on exhaustion, with unchanged counts after rejection and retained old nonce after ciphertext deletion. The trigger failure creates a real database transaction failure and observes rollback of related row counts/counter. The acknowledgment-loss wrapper throws only after firstDb's real commit: an independent client observes the committed row, and same-key reconciliation produces no extra writes. Overflow fixtures are explicitly synthetic boundary states.

Races use reserved firstDb and secondDb, plus an observer/lock-owner connection. Readiness is demonstrated through pg_stat_activity wait_event_type, pg_blocking_pids and expected query fragments, not guessed sleeps. Assertions cover one-sentinel bootstrap, one duplicate-create result/receipt/version plus exact nonce accounting, both replace/revoke orderings, both membership-removal orderings and cross-owner final-capacity serialization. Expiry is still future after the observed key-check wait, then crosses PostgreSQL time while the lock is held; release must deny without mutation. Pending operations are captured and settled in finally after releasing gates. No fake ORM stands in for these locks.

## Isolation and lifetime boundaries

The entry is inert unless invoked, target validation precedes dynamic DB import, and the fixed launcher rejects extra modes/arguments and existing project resources before provisioning. The proof client checks exact feature migration filenames/hashes, delegates to verified empty identity baseline, and checks the resulting public table set. Three distinct reserved pools/backends are service-verified; no reconnect replaces them silently.

The whole-proof120-second deadline includes close. Driver statement/query/lock timeouts bound blocked SQL. A sticky outbound-attempt counter guards new network APIs after setup and is checked after each case and shutdown; it is instrumentation, not an OS firewall. Fixed failure phases hide assertion/driver SQL/cause content. Successful cleanup truncates the exact13-table fixture set without CASCADE; launcher trap tears down only the dedicated project and verifies absence. Failure/timeout uses launcher teardown as the final tmpfs resource boundary.

## Independently repeated offline checks

On corrected source:

- bun --no-env-file test scripts/verify-identity-auth.test.ts apps/server/src/test-support/identity-proof-target.test.ts apps/server/src/test-support/identity-test-target.test.ts: 31 pass, 0 fail, 948 assertions, exit0.
- Exact scoped strict invocation from commands.json, covering three proof modules and launcher tests: exit0, zero diagnostics.
- Recomputed every sequential manifest hash: no mismatches.
- Read actual executable import/unsafe-target subprocess tests: they block IO before import, assert no calls and fixed target denial.
- Prior coordinator-connection-007c1a.md establishes63 actual schema checks with exact SQLSTATE/constraint comparisons and the accepted service-only current-pointer invariant. It does not substitute for these store scenarios.

Programming, TypeScript, remove-ai-slops and code-review perspectives applied. No tautological/deletion/prose tests, unnecessary framework, unsafe production type escape or unsupported runtime success claim found. Shell mocks prove dispatch/refusal/cleanup branches only, explicitly separate from actual database receipts. Synthetic fault seams are narrow and their limits are stated.

## Remaining limits

These are controlled sessions, not HTTP/sign-in; fresh factory, not process/host restart; post-real-commit wrapper loss, not TCP loss; injected near-capacity counter, not a million-row ledger; and native profiles/readiness/dispatch/decryption delivery remain unimplemented. HTTP producer authorization, actual process/network interruption where required, RFC008/010 grant issuance and delivery/reconciliation still need their own proof. No additional blocking case is missing for the bounded metadata-store behaviors claimed here.

Evidence directory: local evidence

# RFC-007b independent code review

Verdict: PASS for bounded crypto; WATCH for the explicitly deferred operational integration.
codeQualityStatus: CLEAR
recommendation: APPROVE
blockers: []

## Scope and evidence identity

Reviewed the complete new source in apps/server/src/modules/connections/crypto.ts, crypto.test.ts, and scripts/verify-connection-crypto.ts, plus tasks/007b-implement-connection-secret-crypto.md, docs/decisions/connection-secrets.md and local evidence artifacts. These source files are untracked additions in the dirty working tree; the review is of their full contents, not a claim that HEAD contains them. Consulted local evidence No implementation edits, dependency installs, database, provider, server or Git mutations were performed.

Independently computed SHA-256 values match the executor's source-hashes.txt:

- crypto.ts: bf6c52be3c14d6a5836f73c575380f1ed9ef68bd6ad0ed58ec187620266ef290
- crypto.test.ts: 0336cf7048e215486851ffa981b0bccadf98599920903ac4445c08eefa5a4221
- verify-connection-crypto.ts: 51dac32e127ed6857affb6b9a523c5a2e02dd70fd315f3314d8d0fdc8d254cdd
- task007b: 5ac3b8a2311c7f32891ea8577106b52a95dc9f11b5a8460d21e747ef3264c8bc

## Findings by severity

- CRITICAL: none.
- HIGH: none.
- MEDIUM: none.
- LOW: none requiring a source change.

## Independent verification

Ran `bun test apps/server/src/modules/connections/crypto.test.ts`: 50 pass, 0 fail, 58 assertions, Bun 1.3.14, exit 0.

Ran `bun run scripts/verify-connection-crypto.ts`: all 27 named checks true, Bun 1.3.14, exit 0. This is actual installed native crypto compatibility using in-memory synthetic values, not persistence or restart proof.

Ran `bunx --no-install tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --moduleResolution bundler --module esnext --target esnext --skipLibCheck --types bun apps/server/src/modules/connections/crypto.ts apps/server/src/modules/connections/crypto.test.ts scripts/verify-connection-crypto.ts`: exit 0 with no diagnostics. Inspected executor lsp.json (zero diagnostics); did not independently rerun LSP. No full-project build, browser or separate security scanner was run for this pure bounded primitive. Supplementary no-excuse tool failure is disclosed in the executor record, not represented as a passing gate.

Inspected mutation source and failure log directly: the only production mutation substitutes a constant for ownerUserId in AAD. The changed-owner denial and independent ADR-envelope tests both fail (48 pass / 2 fail). This is a meaningful behavioral mutation, not a test that mirrors implementation. The mutation was not independently rerun. Its retained source is non-executable .txt evidence; the original .mutation directory is empty. Tests/proof contain no listeners, containers, database connections or provider actions and launch no live QA resource requiring teardown. Review commands completed synchronously.

## Contract assessment

crypto.ts:4-20,43-49 validate canonical 32-byte base64 configuration and bounded key ID, strict context and envelope, exact 12-byte nonce and 16-byte tag, and byte limits. No key is exposed through the returned service object. Configuration/context are trusted-service boundary data; arbitrary malicious JS getters/proxies are outside this accepted contract.

crypto.ts:52-57 binds the exact versioned ADR AAD tuple, including owner, connection, kind, credential version and key ID. Tests also independently encrypt an ADR envelope and substitute key ID while supplying the same key bytes, avoiding a false sense of AAD coverage from schema rejection alone.

crypto.ts:60-103 uses the installed AES-GCM primitive with explicit tag length. Decryption calls final before assembling and returning plaintext; authentication failure never returns update bytes. Buffer clearing is best effort and does not claim secure JavaScript erasure. UTF-8 validation preserves BOM, combining characters, whitespace and original bytes without normalization. Separate key-check AAD prevents credential/check interchange.

crypto.ts:106-119 returns frozen methods with private key closure. Generic errors replace native exception content and have no raw cause. This is intentional secret-boundary sanitization, not swallowed success. Envelopes remain private values; later DTO/log enforcement is outside this module.

## Skill perspectives

Loaded omo:programming SKILL.md and TypeScript reference, omo:remove-ai-slops SKILL.md, and code-review-and-quality SKILL.md. Applied the overfit/slop and code-quality perspectives to production and tests. No deletion-only, removal-pinning, prompt-prose, tautological or implementation-constant-only tests were found. Protocol constants and independently encoded AAD fixtures test a specified interoperability contract. No untyped escape hatches, speculative abstractions or needless extraction/normalization were found. Boundary parsing is required by the accepted unknown-input factory/envelope contract. Catch-all error translation earns its place at this secret boundary. Neither skill perspective yields an actionable violation for this scope.

## Deferred gates and limits

Approval does not establish persistent nonce uniqueness/tombstones, collision retries, encryption cap, atomic key-check initialization/startup, restart durability, custody, schema, grants, dispatch, provider delivery or native-profile support. Task007b accurately defers these to 007c and later integration work. The two-random-nonce check is a smoke check, not proof of lifetime uniqueness. Parent RFC-007 and aggregate G002 remain incomplete.

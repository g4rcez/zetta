# RFC-007b: Bounded connection-secret crypto

- Status: done for this bounded primitive; coordinator accepted independent CLEAR/APPROVE review. Parent RFC-007 remains incomplete.
- Scope: trusted, in-process API-key encryption only, following [accepted ADR](../docs/decisions/connection-secrets.md). No route, schema, environment, dependency, grant or native-profile changes.

## Contract

`apps/server/src/modules/connections/crypto.ts` exports `createConnectionCrypto`, `ConnectionCryptoError`, and readonly `ConnectionEnvelope`. The factory takes trusted configuration `{key, keyId}` as unknown boundary input. Canonical base64 must decode to exactly 32 bytes; key ID is `[a-z0-9_-]{1,32}`. The decoded key stays in the returned methods' closure. The optional second argument is a trusted randomness seam for deterministic failure testing; production callers omit it.

The frozen service provides `seal(bytes, context)`, `open(envelope, context)`, `createKeyCheck()`, and `verifyKeyCheck(envelope)`. Context is exactly `{ownerUserId, connectionId, kind: "api-key", credentialVersion}`. Owner IDs are well-formed Unicode of 1–256 UTF-8 bytes, connection IDs canonical lowercase UUIDs, and versions integers 1–2,147,483,647. Native-profile input is rejected. These pure cryptographic methods confer no authorization and must remain private to the trusted service; later dispatch must authorize before calling `open` and must never expose it through HTTP/model tools.

Envelope v1 uses fixed AES-256-GCM, fresh 12-byte random nonce, explicit 16-byte tag and 1–16,384 exact UTF-8 bytes. Unknown fields/version/algorithm/key IDs and invalid binary lengths fail closed. AAD is exactly UTF-8 JSON of `["zetta.connection",1,keyId,ownerUserId,connectionId,kind,credentialVersion]`. `open` authenticates `final()` before returning any bytes and rejects invalid UTF-8 even after successful authentication. Temporary plaintext buffers are cleared best effort; JavaScript strings/decoder allocations and copied caller data are not guaranteed erased.

Key-check AAD is exactly `["zetta.connection-key-check",1,keyId]`; the fixed public sentinel is UTF-8 `zetta.connection-key-check.v1`. Verification returns void or throws. Neither key-check method initializes storage or asserts startup readiness. Errors have only fixed `connection-crypto-configuration` or `connection-crypto-unavailable` messages/codes and no raw cause. Returned service JSON is `{}`; envelopes are private storage values and must not enter DTOs/logs.

## Direct evidence

Evidence root: `.omo/evidence/connection-007b/`; identical copy under the active attempt's `connection-007b/`. Source hashes bind this record to the implementation, tests and proof.

| Scenario | Invocation | Binary observable | Artifact |
| --- | --- | --- | --- |
| First tests before implementation | `bun test apps/server/src/modules/connections/crypto.test.ts` | Fails because module does not yet exist | `tests-red.log` |
| UTF-8 byte boundaries, BOM/Unicode preservation, canonical key validation, exact independently encoded AAD, each identity substitution, tampering, malformed envelopes, no unauthenticated return, key-check domain/wrong-key rejection, sanitized randomness errors, key serialization | `bun test apps/server/src/modules/connections/crypto.test.ts` | 50 pass, 0 fail, exit 0 | `tests-green.log` |
| Mutation sensitivity: replace owner AAD with a constant in an isolated source copy | `bun test ./apps/server/src/modules/connections/.mutation/crypto.test.ts` | 2 failures: changed owner accepted and independent ADR envelope rejected; exit 1 | `mutation-red.log`; source copies retained as non-executable `mutation/*.txt` |
| Actual installed Bun AES-GCM compatibility with in-memory synthetic key/bytes only | `bun run scripts/verify-connection-crypto.ts` | Bun 1.3.14, every named boolean true, exit 0; output contains no key/envelope/plaintext | `runtime-proof.log` |
| Strict targeted diagnostics | `bunx --no-install tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --moduleResolution bundler --module esnext --target esnext --skipLibCheck --types bun apps/server/src/modules/connections/crypto.ts apps/server/src/modules/connections/crypto.test.ts scripts/verify-connection-crypto.ts` | Exit 0, no diagnostics | `types.log` |
| Connections and proof LSP diagnostics | `mcp__lsp.diagnostics` on connections directory and proof script, severity all | 2 module files scanned, zero diagnostics; script reports none | `lsp.json` |

The skill's supplementary no-excuse checker could not run: its imports require `typescript/unstable/async` and `typescript/unstable/ast`, absent from installed TypeScript 6.0.3. Its actual failure is retained in `no-excuse.log`; no dependencies were changed. Strict compiler and source LSP checks above succeeded. Biome JSON LSP is unavailable and was not installed.

## Remaining operational gates

Coordinator acceptance: independently inspected source and observed50 tests/58 assertions plus all27 native crypto checks, exit0. [Independent review](../docs/verification/reviews/connection-007b-review.md) re-ran tests, strict diagnostics and native proof with no blocker. crypto.ts SHA256 `bf6c52be3c14d6a5836f73c575380f1ed9ef68bd6ad0ed58ec187620266ef290`. This accepts the pure primitive only and authorizes the separate007c1 storage-schema assignment; no persistent secret or dispatch capability is claimed.

RFC-007c must implement persistent nonce uniqueness/tombstones, maximum three collision retries, the 1,000,000-encryption cap, atomic key-check initialization, startup verification, owner-authorized storage and request MAC/idempotency. This primitive generates random nonces but cannot prove persistent uniqueness or startup state. MAC is intentionally deferred to that cohesive service assignment.

Separate real PostgreSQL/restart, revocation/race, dispatch integration, native-profile isolation, custody/backup/restore and rekey proofs remain required. No browser feature, provider access, credential delivery, database persistence or restart guarantee is claimed here.

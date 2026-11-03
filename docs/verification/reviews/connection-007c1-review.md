# RFC-007c1 independent schema review

Reviewed 2026-10-22. Acceptance is limited to the offline schema and generated feature delta.

- codeQualityStatus: CLEAR
- recommendation: APPROVE
- blockers: [] for this schema slice
- Actual PostgreSQL enforcement, service lifecycle and parent RFC-007 completion remain unverified.

## Findings by severity

- CRITICAL: none.
- HIGH: none.
- MEDIUM: none.
- LOW: none.

## Scope and source identity

Read the full new `packages/db/src/schema/connections.ts`, `connections.test.ts`, `packages/db/drizzle.connection-test.config.ts`, generated `connection-test-migrations/20261022171713_connection_initial/{migration.sql,snapshot.json}`, schema barrel, and the existing identity test's connection import-allowlist adaptation. Read `tasks/007c1-define-connection-storage-schema.md`, accepted `docs/decisions/connection-secrets.md`, and the active attempt's `connection-007c1/{report.md,commands.json,source-hashes.json,ddl-inspection.json}` with generator/type/test receipts. The broader dirty tree contains earlier identity work; this review does not attribute all changes against HEAD to 007c1.

Independently recomputed every entry in the writer's seven-file hash manifest: all match. Reviewed source hashes:

```text
3bd54ce01d5d5936c1cf70541e977c13a09baf897bd4b49d9b33a5b6f9ee7ea3  packages/db/src/schema/connections.ts
7d13d4bfc1b0504e542e374be5eb3854ee500a94449c36195f42e5f32b5abc8e  packages/db/src/schema/connections.test.ts
a1265a53526649eee2ef1c93beee4c7ee66f27aceba853fac142d4ab43d6d0b3  packages/db/src/schema/index.ts
3f1c4a69140358fc8ee87f7e0ab0e966d32a80a1e53661acbfad79ad6099f264  packages/db/drizzle.connection-test.config.ts
db12c2acb8d3a060f452568ff8077fbb85068595bbba74d39a9a27901632d31f  migration.sql
b8ac4e508db60a20a6823820bdf80a5ddc83b24094a6fd5f7f2e859d6837cdf7  snapshot.json
296bf952a908afd7edb35d855e987208ccc9eebe9bf1b86b204bcbfd5cc41c96  packages/db/src/schema/identity.test.ts
145d6578835d6405f9d952d1e1ad8c67f0d8d88ed490681f216b6eb27f65f9ed  tasks/007c1-define-connection-storage-schema.md
```

Migration/snapshot names above are relative to the generated migration directory. Evidence root: `local evidence`.

## Contract assessment

**Owner and kind:** `connection` restrictively references the existing auth user. Credential and receipt tables both reference `(connection.id, ownerUserId, kind)` through restrictive composite foreign keys; the matching unique constraint exists on the parent. API-key kind is enforced by SQL checks, not merely TypeScript enum inference. Owner byte length and provider/label syntax/size constraints match the selected contract. Provider installation membership and authenticated actor derivation remain service responsibilities; these FKs do not implement authorization.

**Nonce retention and purpose:** the lifetime `(keyId, nonce)` primary key is independent of connection/credential deletion. The ledger has no outgoing FK and no cascade. Credential purpose requires non-null connection/version; key-check purpose requires both null. The credential's four-column nonce FK binds the nonce to that exact credential identity; this also prevents using a key-check nonce, whose identity columns must be null. The key-check's three-column FK explicitly includes its checked `key-check` purpose. Required referenced unique constraints exist. Explicit privileged ledger deletion remains possible and is correctly excluded from the structural retention guarantee.

**Envelope and accounting:** both envelope consumers require version 1/AES-256-GCM, canonical bounded key ID, bytea nonce/tag/ciphertext with 12/16/1-16384 byte bounds. The singleton primary key plus `id = 1` allows at most one key-check row. Its encryption count is constrained to 1-1,000,000. The schema does not pretend that these bounds authenticate ciphertext, enforce the active configured key, ensure sentinel existence or count actual historical encryptions; startup verification and serialized accounting are explicit successor obligations.

**Original mutation receipts:** the owner+operation UUID primary key and 32-byte request MAC implement the needed storage identity. All original safe DTO fields are scalar columns, with receipt connectionId mapping to DTO id; no current-row join or unbounded JSON payload is needed. Create and replace/revoke checks distinguish initial versus expected+1 revisions and correct result state. Exact MAC computation/constant-time matching, canonical UUID input, immutable identity, no reactivation, version advancement and fresh membership authorization still belong to the service. A receipt alone does not prove those operations were performed correctly.

**Current credential pointer:** the accepted omission of the reverse FK is explicit in source and handoff. An immediate reverse FK would complicate first insertion with a cycle; the selected service must create connection, version, nonce and receipt atomically, and resolution must reject missing or stale current versions. No database-level pointer-existence guarantee is claimed. This accepted design is not reopened as a blocker.

**Generated delta:** SQL creates only the five connection feature tables and their index/constraints; it references pre-existing `user` without creating, altering or dropping auth/identity tables. Snapshot v8 has the initial zero prevId, five tables, 55 columns, five PKs, five FKs, three unique constraints, 33 checks and one index. Independently compared all 55 live-schema column SQL types/nullability values to the snapshot, and all 33 live compiled CHECK expressions to both snapshot and SQL: zero mismatches. Primary-key columns need no redundant inline NOT NULL in the emitted SQL. The isolated generation config imports only this feature schema. Writer generation and no-delta logs were inspected, not rerun because generation can write artifacts.

## Independently repeated verification

1. `bun --no-env-file test packages/db/src/schema/connections.test.ts packages/db/src/schema/identity.test.ts`: exit 0; 13 pass, 0 fail, 199 assertions, 159 ms.
2. From `packages/db`, repeated the exact scoped strict command below: exit 0, no diagnostics.
3. Read-only Bun comparison of live Drizzle schema with the retained snapshot/SQL: 33 CHECK expressions and all 55 column types/nullability agree; no mismatches. An initial invocation at repository root could not resolve package-local Drizzle and executed no comparison; rerun from `packages/db` succeeded.

```sh
bun --no-env-file ./node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --exactOptionalPropertyTypes --noPropertyAccessFromIndexSignature --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --verbatimModuleSyntax --skipLibCheck --target ESNext --module ESNext --moduleResolution bundler --types bun src/schema/connections.ts src/schema/connections.test.ts src/schema/index.ts drizzle.connection-test.config.ts
```

The writer's standard package typecheck passes. Broader extra-strict diagnostics and the optional skill checker failures are disclosed in its report; neither is claimed passing here. LSP receipts were inspected, not rerun. No database/server/container/provider/install/Git mutation occurred. Tests launch only bounded local Bun import-check children.

## Test and skill perspective

Applied code-review-and-quality, programming/TypeScript and remove-ai-slops, already loaded in this review session. The tests are expressly offline schema/SQL compilation tests, not simulated PostgreSQL enforcement. Binary-parameter preservation, composite FK topology, nonce retention structure, safe receipt projection and generated migration scope are meaningful machine-consumed contracts. Compiled SQL assertions pin specified envelope/security constraints rather than natural-language prompts; their limitation is accurately documented. No deletion-only, requested-removal, tautological or unnecessary production parsing test pattern warrants a finding. Shared metadata/envelope builders have multiple real consumers and prevent divergent constraints. No untyped escape hatch or needless production abstraction was found in the assigned source. No remaining skill-perspective violation identified.

## Remaining acceptance gates

The next storage service and disposable PostgreSQL proof must actually execute this delta after the auth baseline and test valid controls plus invalid owner/kind/nonce-purpose/length/version/counter/receipt rows. Prove nonce tombstones survive ciphertext deletion, no nonce reuse, bounded collision retries, serialized count exhaustion and key-check bootstrap/wrong-key/restart handling. Then prove atomic create/replace/revoke, exact operation replay/conflict, lost-acknowledgment reconciliation, original receipt after later mutations, membership/admin/A-B denial, expected revisions, expiry and missing-current-version denial. Key-dependent state must remain private in DTOs/logs. RFC-008/010 must integrate durable dispatch and revocation ordering; native profiles remain unsupported. None of these operational claims is satisfied by this offline acceptance.

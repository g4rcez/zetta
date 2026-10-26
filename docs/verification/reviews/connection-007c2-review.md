# RFC-007c2 independent metadata-store review

## Current verdict — RFC-007c2a delta, 2026-10-22

- codeQualityStatus: CLEAR
- recommendation: APPROVE for the offline metadata-store source slice
- blockers: []
- M1 is resolved on the source hashes below. The original finding, reproduction and prior WATCH verdict are preserved below as historical evidence and superseded by this section. No actual database proof is implied; RFC-007c3 and parent RFC-007 remain incomplete.

Current findings by severity: CRITICAL none; HIGH none; MEDIUM none; LOW none.

Inspected the task 007c2a, actual changed source/tests, allocation probe, red-test failure and source manifest under current-attempt connection-007c2a. There is no report.md in that directory; the task contains the evidence matrix and exact invocations, and the individual artifacts exist. No missing proof was treated as passing.

`store-contract.ts:23-50` now completes whole strict-object validation before allocating a secret copy for create or replace. `copySecret` makes one owned buffer, checks its bounds again and validates UTF-8 on that owned copy; rejection wipes it in catch. Successful parsing stays synchronous before mutate/any await. A concurrently changed shared input cannot invalidate post-copy validation or alias returned storage. This is best-effort buffer lifetime reduction, not guaranteed erasure of JavaScript strings.

The new tests meaningfully exercise invalid siblings/extras on both operations (no allocation), corruption of the actual allocated copy (fatal UTF-8 rejection and all-zero cleanup), caller preservation and shared-buffer mutation after parsing (one private copy). The retained red run fails with eight allocations versus expected zero. Allocation observation is appropriate to this residency bug, not a source assertion or implementation-string test; spies restore in finally and no secret content is logged.

`store.ts:24-26` passes the optional trusted third constructor argument to `createStoreKeys`, which forwards it to the existing crypto seam (`store-keys.ts:7-8`). Omitted/undefined retains crypto's randomBytes default. Strict JSON options and request schemas admit no nonce source. Tests observe injected twelve-byte nonce values in key-check and seal and reject nonceSource in options/request data. The seam does not add a resolver, request authority or fake transaction implementation. Actual ledger collision/retry and constructor-to-DB behavior still require RFC-007c3.

Independently repeated:
- Focused store, contract and crypto command recorded below: **66 pass, 0 fail, 159 assertions**, exit 0.
- Exact targeted strict command recorded below: exit 0, zero diagnostics.
- `bun --no-env-file run .omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/connection-007c2a/allocation-probe.ts`: exit 0; denied=true, copyAllocated=false, copyRemainsNonzero=false, callerUnchanged=true.
- All five current SHA256 values match the author's manifest:

```text
99d19f64891647931e9971bd27dd0c5d3147e09867a1f8a702e27454886af1fa  store.ts
5d4e67c16eef6cc9a040e9e28c55cc5a0a9bc74c37e6c98699d3a6c34c473647  store-contract.ts
a1c4293a3a091cd4f1137c46c827a7b4a7b7f7eb5f32d6de16aad365928f00d0  store-keys.ts
a785a5319c776044a7917539a766998b37b93606b6fb2ef9488af9d9a6b5ff1f  store.test.ts
f73b8f84c1541315f2117c7bf0e590bd0cc56ad646fa4f71ec7aebce2b4dead6  store-contract.test.ts
```

Programming/remove-ai-slops/code-review skill perspectives applied again to the delta; no unnecessary parsing, unsafe escape hatch, tautological/removal test or needless abstraction found. Existing PostgreSQL gates listed below are unchanged. No DB, container, launcher, schema, product source or Git state was changed by this review.

## Historical RFC-007c2 review (superseded verdict)

Reviewed 2026-10-22, against the original frozen five-file source manifest.

- codeQualityStatus: WATCH
- recommendation: APPROVE for offline source acceptance
- blockers: [] for this bounded source slice
- Actual PostgreSQL lifecycle/locking/commit behavior remains unverified under RFC-007c3. Parent RFC-007 is incomplete.

## Findings by severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

M1 — An invalid sibling input field leaves an allocated secret copy uncleared (`apps/server/src/modules/connections/store-contract.ts:23`, `:31`). The secret field transform allocates `Buffer.from(value)` before the complete strict object is accepted. If a valid UTF-8 secret accompanies an invalid label, expiry, identity or extra field, `safeParse` fails and `mutate` is never entered, so its `finally` cannot wipe that copy. Only UTF-8 rejection clears the field-local copy. This does not expose bytes through a DTO/error or defeat encryption, but leaves unnecessary plaintext residency on a routine failed-validation path despite the best-effort cleanup contract.

Independent read-only Bun probe temporarily intercepted Buffer.from in a disposable process, retained only the buffer allocated from its synthetic input and called parseCreate with an empty label. It observed `denied: true`, `copyAllocated: true`, `copyRemainsNonzero: true`, `callerUnchanged: true`; the probe restored Buffer.from and wiped its synthetic buffers. Suggested follow-up: validate the complete object before creating the owned secret copy, or retain and wipe every allocated copy when object parsing fails. Preserve synchronous caller-byte copying for successful requests and caller ownership of the original bytes. Add the narrow failed-object cleanup regression. No implementation edits were made by this reviewer.

Retained reproduction artifact, exact invocation from repository root:

```sh
bun --no-env-file - <<'TS'
import { parseCreate } from './apps/server/src/modules/connections/store-contract';
const secret=Buffer.from('synthetic-cleanup-probe');
const originalFrom=Buffer.from;
let copied;
Buffer.from=function(...args){const result=Reflect.apply(originalFrom,Buffer,args);if(args[0]===secret)copied=result;return result;};
let denied=false;
try{parseCreate({operationId:'00000000-0000-4000-8000-000000000001',provider:'test',label:'',secret});}catch{denied=true;}finally{Buffer.from=originalFrom;}
console.log(JSON.stringify({denied,copyAllocated:copied!==undefined,copyRemainsNonzero:copied?.some(x=>x!==0),callerUnchanged:secret.equals(Buffer.from('synthetic-cleanup-probe'))}));
secret.fill(0);copied?.fill(0);
TS
```

Observed exit 0, stdout:

```json
{"denied":true,"copyAllocated":true,"copyRemainsNonzero":true,"callerUnchanged":true}
```

### LOW

None.

## Scope and source identity

Read full `store.ts`, `store-contract.ts`, `store-keys.ts`, `store.test.ts`, `store-contract.test.ts`, the 007c2 task and active-attempt report, the accepted 007c1 service invariants and connection-secrets ADR, and current identity actor-provenance/crypto dependencies. The coordinator's `asc` query export was inspected separately. No schema, launcher, environment or composition edits were included in this review.

All five SHA256 entries independently match:

```text
70c56142441733e78b257546b19e42bcf69c7e91ddee2c1f0f92e393a5672ea0  store.ts
c8553a0e9d65712f49483684ca2774a179ccae75f4dbb3259d01fb3a94b5c8ae  store-contract.ts
2cd829c46b2723cb4ade4e8f86a7d01ed45248ac424010660994b3e17cc6fdf1  store-keys.ts
884fd8cf4aba4ebe2858b757851a4e09c40ab417698d7bd5e8420bbda3e45717  store.test.ts
cefd4dc1a1be5f8c226b4e14ccfac5b94d8135621d354c1e614915d32b5f279e  store-contract.test.ts
```

Files are under `apps/server/src/modules/connections/`. Evidence directory: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/connection-007c2/`.

## Contract assessment

**MACs and cursors:** request arrays match the ADR's operation-specific field order, domain/version, owner, operation UUID and every effective operation argument. Create excludes the newly generated connection UUID as required. Labels and UTF-8 credential bytes retain BOM/NUL/whitespace without normalization; expiry omission becomes explicit null. HKDF request/cursor domains are separate, signatures are fixed length and compared using timingSafeEqual. Cursor verification binds owner, UUID, canonical JSON/base64url and signature; keyset queries use owner scope and ascending UUID with a bounded limit+1 lookahead. The independent Node crypto oracle uses explicit ADR input arrays rather than reusing the implementation's builder.

**Authorization:** requireConnectionActor consults the existing WeakSet-issued actor contract through requireOwned; structural/admin copies cannot bypass it. Every operation then selects and locks the current membership row before accessing private data or returning a replay. Connection and receipt lookups carry owner predicates; updates preserve them. Admin status adds no special path. Fresh session resolution per request remains the trusted caller's requirement, while current membership is rechecked by the store itself.

**Startup and key accounting:** explicit initializeEmpty is required before bootstrap, and all five tables must be empty. An advisory transaction lock serializes the absent-singleton case; the actual key-check row is then locked and cryptographically verified. Total nonce count must equal encryptionCount and all ledger entries must belong to the configured key; the sentinel nonce must have key-check purpose. Mutations lock the key-check row, refuse capacity exhaustion and reserve nonce identities with at most three fresh seals and ON CONFLICT DO NOTHING. The existing global nonce PK/FKs support this design. Concurrency and count correspondence have not been exercised on PostgreSQL.

**Mutation ordering:** membership serialization precedes receipt lookup, so same-owner concurrent operation IDs can settle on one committed result. Matching receipt MAC returns original stored metadata before stale revision, revoked state, provider-list changes or now-expired input checks. New replace/revoke operations lock the owned connection, reject stale/inactive/overflow state, then acquire key accounting and database time. Creation supplies the FK parent; replacement inserts the new encrypted version before moving its pointer. Version, nonce, counter, metadata and receipt share the transaction. Revoke advances only revision/state and retains credential and nonce rows. Current-version existence remains the accepted service/transaction invariant; no reverse-FK guarantee is claimed.

**Error/secret boundaries:** unexpected mutation transaction errors become fixed outcome-unknown, rather than a rollback assertion or retry with a new operation ID. Reads/init use unavailable; recognized access/conflict/input outcomes remain fixed. Raw driver messages/causes and SQL arguments are not attached. Successful parsing copies caller-owned bytes before asynchronous work; mutate's finally wipes that internal copy on success, authorization failure, replay and transaction rejection. M1 identifies the earlier parse-failure exception. Crypto temporary plaintext/raw key buffers have their own best-effort clearing; immutable base64/JSON/key strings cannot be securely erased in JavaScript and are not represented as such. No public plaintext resolver is exposed, and explicit metadata projections exclude owner, key ID, MAC, ciphertext and secret details.

## Independently repeated verification

- `bun --no-env-file test apps/server/src/modules/connections/store.test.ts apps/server/src/modules/connections/store-contract.test.ts apps/server/src/modules/connections/crypto.test.ts`: exit 0; 61 pass, 0 fail, 134 assertions, 49 ms. This includes 50 existing crypto cases, not 61 store mutation scenarios.
- Repeated the exact targeted strict command below: exit 0, no diagnostics.
- Recomputed source manifest: five matches.
- Reproduced M1 using the synthetic allocation probe described above. No raw synthetic bytes were printed.

```sh
bunx --no-install tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --moduleResolution bundler --module esnext --target esnext --skipLibCheck --types bun apps/server/src/modules/connections/store.ts apps/server/src/modules/connections/store-contract.ts apps/server/src/modules/connections/store-keys.ts apps/server/src/modules/connections/store.test.ts apps/server/src/modules/connections/store-contract.test.ts
```

No successful ORM transaction is fabricated by the tests. The failing transaction seam proves invalid-configuration exclusion and opaque initialization failure only. No DB, container, service, provider, real credential, installation or Git mutation was performed. LSP receipt was inspected, not rerun; strict checks cover final sources.

## Skill perspective

Applied previously loaded code-review-and-quality, programming/TypeScript and remove-ai-slops perspectives. Tests cover boundary behavior, exact cryptographic serialization and provenance using independent inputs. No deletion-only/prose pin or implementation-constant mirror warrants a finding; DTO/key absence checks guard the public API confidentiality boundary. Production parsing is at untrusted input, cursor, crypto or persisted-row boundaries and is justified. No fake lock/commit success claim, untyped escape hatch, oversized module or unnecessary data extraction was found. M1 is a concrete resource-lifetime issue under the programming perspective, not a style request. The three modules separate contract parsing, keyed encoding and transaction orchestration without introducing a second grant engine.

## Required bounded RFC-007c3 cases

Use the separately owned disposable PostgreSQL proof; do not create a competing database project. Require actual create/list/replace/revoke and original-receipt replay after later mutation/expiry; changed MAC/type/target conflicts; caller-byte preservation and fixed serialized errors. Prove A/B/admin and removed-member denial, including lock-order races, plus owner-bound pagination and stale cursors. Exercise concurrent same-operation create, competing expected revisions, capacity serialization, collision retries, retained tombstones and rollback of all related rows on insertion failure. Verify absent/partial/corrupt/wrong-key bootstrap, all-key nonce counting, persistent restart and original DTO reconstruction. Inject COMMIT acknowledgment loss and confirm identical-operation reconciliation without duplicate writes or invented rollback. Record actual SQLSTATEs for restrictive FKs rather than assuming all constraint failures share one category. Dispatch grants, readiness invalidation and plaintext delivery remain RFC-008/010 integration, not this metadata store's completion claim.

For a deterministic collision oracle, the existing crypto helper already accepts a nonce-source dependency. A narrowly scoped trusted constructor third argument propagated through createStoreKeys to that existing seam is reasonable for the upcoming proof; preserve the secure random default and never accept a nonce source through parsed request/options JSON. This is a suggested follow-up, not part of the frozen hashes reviewed here.

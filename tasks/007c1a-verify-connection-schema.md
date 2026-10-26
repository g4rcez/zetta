# RFC-007c1a: Disposable PostgreSQL connection schema proof

Status: done for actual schema enforcement; coordinator independently repeated all63checks/cleanup, exit0, after independent DDL clearance. Parent RFC-007 remains incomplete.

## Scope and prerequisites

Consumes [007c1 schema](007c1-define-connection-storage-schema.md), accepted [connection secrets ADR](../docs/decisions/connection-secrets.md), and the existing disposable identity proof infrastructure. No production database, environment schema, dependencies, secret service, crypto changes, provider, native profile or dispatch grant.

Owned paths: `packages/db/src/connection-proof-client.ts`, `apps/server/src/modules/connections/schema.integration.ts`, additive fixed `connection-schema` mode in `scripts/verify-identity-auth.sh` and its tests, this document and the evidence directory. Historical baseline/helper/schema/migrations remain untouched.

## Reviewable execution contract

Approved actual invocation: `bash scripts/verify-identity-auth.sh connection-schema` from the repository root. The launcher refuses existing dedicated resources, retains existing environment/secret-selector denials before provisioning, uses only the existing local image with loopback and tmpfs checks, and removes only its owned container/network on success or failure. It never removes volumes or adopts existing resources.

`openConnectionProof(connectionString)` verifies the feature migration folder contains exactly `20261022171713_connection_initial`, containing only `migration.sql` and `snapshot.json`, whose SHA-256 hashes are respectively `db12c2acb8d3a060f452568ff8077fbb85068595bbba74d39a9a27901632d31f` and `b8ac4e508db60a20a6823820bdf80a5ddc83b24094a6fd5f7f2e859d6837cdf7`. It then reuses `openIdentityProof` for the verified fresh service, advisory owner and three reserved clients. Feature migration runs via installed Drizzle on the reserved owner; the helper checks the exact resulting 13 public table names. It exports owner/first/second clients, firstDb/secondDb, close and healthy. It deliberately does not export/call eight-table `cleanupFixtures`, which cannot apply after adding connection tables.

The executable is inert on import. Explicit invocation first calls the existing target/auth-environment guard, then starts a 90-second whole-proof deadline covering dynamic imports, database work, rollback and awaited client termination. After both fixed migrations finish, instrumentation blocks new sockets, listeners, DNS, HTTP/fetch/Bun network entry points with a sticky attempt counter. This is not a firewall and does not instrument the earlier guarded setup/migration phase. Feature migration itself uses the already reserved owner and opens no pool.

All fixture rows are synthetic and held in one transaction. Each scenario uses a savepoint and rolls back. Nested negative cases use PostgreSQL's savepoint-name shadowing: the inner savepoint is rolled back and released before the outer scenario rolls back its original savepoint. Each negative oracle privately compares both SQLSTATE and named constraint; a different failure cannot pass. No raw errors, SQL/parameters or fixture values are printed. Positive controls create complete A/B graphs; maximum-size readback also checks exact row count. Envelopes are synthetic bounded binary data, deliberately not cryptographically authenticated credentials.

Scenarios cover valid owner graphs/shared cross-owner operation IDs, user/owner/kind/nonce identity denials, duplicate nonce/key-check/receipt identities, tombstone retention after replacement and ciphertext deletion, nonce/tag/ciphertext boundaries, algorithm/envelope version/key-ID denial, singleton/counter bounds, provider/Unicode label bounds, positive revision/version metadata, receipt MAC/operation/state/expected-revision semantics and original-result preservation. A deliberately accepted dangling current-version pointer documents the missing reverse FK and mandatory future service invariant; it is rolled back and never described as a DB rejection guarantee. Final readback requires zero fixture rows, then reserved clients close and the launcher removes the dedicated tmpfs service.

## Completion record

Preparation evidence: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/connection-007c1a/report.md`. Exact invocations, outcomes and artifact paths are in `commands.json`.

- `bash -n scripts/verify-identity-auth.sh`: exit 0.
- Focused launcher and existing target tests: 28 pass, 0 fail, 923 assertions. Includes actual inert-import/unsafe-target subprocess, shell dispatch/cleanup fixtures, ownership refusal and unchanged target-selector checks. These are not Docker/PostgreSQL integration evidence.
- Assigned source strict TypeScript with exactOptionalPropertyTypes, noUncheckedIndexedAccess, noUnusedLocals/Parameters, noFallthroughCasesInSwitch: exit 0. Standard DB package typecheck: exit 0.
- Optional additional noPropertyAccessFromIndexSignature check fails on 30 pre-existing TS4111 diagnostics imported through identity/auth dependencies; none are in new files. No broad fixes or passing claim.
- LSP tool responses report no diagnostics on the three assigned TS files. Automatic hook reports Biome unavailable, so no Biome validation claimed.
- Initial strict diagnostic found a union-to-Record fixture typing error in the newly added launcher test; fixed by explicitly typing the denial case array and reran the full focused checks.
- No database/container/provider/server/install/Git mutation occurred during preparation. The subsequent expressly authorized actual runs used only the dedicated fresh tmpfs PostgreSQL service; all were cleaned. Test temp directories and subprocesses are cleaned by the fixtures.

Actual database outcome after explicit coordinator go: `bash scripts/verify-identity-auth.sh connection-schema` passed **63 named checks**, fixture rollback readback, no new network attempts, reserved-client close and dedicated container/network teardown; exit 0. `postgres-run-5.log` is the complete passing receipt. `cleanup-readback.json` independently checks dedicated container/network/volume lists empty; `actual-source-hashes.json` binds the executed helper/proof/launcher/Compose and pinned migration artifacts. Final focused launcher/target tests again pass 28/923, scoped strict and package typechecks exit 0. Proof LSP readback in `final-proof-lsp.json`.

Failure evidence retained: run 1 could not access the Docker socket under sandbox and created no resources. Approved escalation runs 2 and 3 rejected the ledger-delete oracle because the expected SQLSTATE was wrong; run 4 captured only safe booleans proving actual state `23001` and the exact expected constraint matched. PostgreSQL RESTRICT deletion reports `23001`, while the insert/update foreign-key cases report `23503`. Corrected only that deletion oracle, kept the exact constraint requirement, and reran the full scenario as run 5. Runs 2–4 each completed dedicated teardown before any source edit/retry. No schema, migration, crypto, store or historical identity helper was changed.

Coordinator acceptance: independent session81769 passed all63checks, fixture readback, client close and exact dedicated teardown, exit0. [Coordinator source-bound receipt](../.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/coordinator-connection-007c1a.md). This accepts actual schema enforcement; final release review still audits the integrated source/evidence. This proof does not implement or certify service authorization, cryptography, race ordering, restart, readiness or dispatch.

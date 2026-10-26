# RFC-010c2: Fixture dispatch schema and offline migrations

Status: offline source accepted after [coordinator independent review](../docs/reviews/dispatch-schema-010c2-review.md),2026-10-22. Parent010 remains incomplete. Actual PostgreSQL proof is a separate assignment and has not run.

Accepted input: [010c1 storage decision](../docs/decisions/dispatch-storage.md) and its [independent review](../docs/reviews/dispatch-storage-010c1-review.md). Coordinator explicitly authorized the three-table schema, installed offline generator, generated custom migration and focused diagnostics; no database apply/service/worker/native execution.

## Owned paths and exported contract

- `packages/db/src/schema/dispatch.ts`: exports dispatchCapacity, dispatchClaims, dispatchGrants;22 named checks, three restrictive composite FKs, six unique constraints and three indexes. Claims reference the existing runAttempts unique triple; fixture grants require both credential fields NULL. Canonical values remain bound text, never JSON normalization.
- `packages/db/src/schema/dispatch.test.ts`: seven offline contract tests; inert import, parameter binding, complete FK/unique graph, all-unreleased index predicates, bounded/closed checks, generated scope/snapshot lineage and guarded migration coverage.
- `packages/db/src/schema/index.ts`: additive dispatch export only. Root owns the legacy identity-test import allowlist adjustment.
- `packages/db/drizzle.dispatch-test.config.ts`: feature-only offline config, no environment or credentials.
- `packages/db/dispatch-test-migrations/20261022191656_dispatch_initial/`: generator-owned initial SQL and snapshot.
- `packages/db/dispatch-test-migrations/20261022191701_dispatch_guards/`: generator-owned custom lineage/snapshot, explicitly authorized hand-authored row guard SQL.

Five functions/ten triggers reject singleton mutation, history DELETE/TRUNCATE, non-initial insertion, immutable identity changes, fact/state regression and invalid revision increments. Pending-to-pending permits only exact no-op. Unknown grants can acknowledge without inventing issued_at or restoring admission. Released claims are immutable; cleanup facts and receipt/cancellation facts bind once. Guards take no extra cross-table locks.

## Evidence and limitations

[Evidence report](../.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/dispatch-010c2/report.md) contains command/scenario/artifact mapping, generator receipts, diagnostics and final source hashes.

Red-first focused import failed before implementation. Final focused invocation `bun --no-env-file test packages/db/src/schema/dispatch.test.ts`:7 pass,0 fail,215 assertions. Scoped strict TypeScript and DB package check-types both exit0. Four source LSP requests returned no diagnostics; the automatic JSON evidence hook reports unavailable Biome and no installation was attempted. Repeat installed generator reports no schema changes. Generated-object inspection found exactly three dispatch tables,22 checks, three FKs/three indexes, five guard functions/ten triggers; no existing table DDL. The accepted009 custom migration hash remains unchanged.

These checks prove the offline schema graph, SQL binding, generated lineage and source structure only. No PostgreSQL applied the SQL, and neither constraints nor triggers are claimed executed. SQLSTATE/constraint-negative controls, insertion/no-op/update/DELETE/TRUNCATE enforcement, SQL NULL logic, actual lock ordering and cleanup remain the next bounded database proof. Authority issuance, canonical semantic provenance, logical-terminal release, real cleanup evidence and capacity/grant races require later service/launcher proofs. Scalar-valid direct SQL is not authority. No credential/native/public producer/worker was enabled.

## Next handoff

Review frozen schema and both migrations. Then separately assign guarded disposable proof source, inspect its pinned hashes/target/cleanup, and explicitly authorize its actual run. Never reuse the legacy eight-table cleanup after adding dispatch; retained tombstones intentionally prevent ordinary deletion. Feature proof teardown must dispose only its owned disposable service. Do not change007/009 schema or accepted migration pins incidentally. Coordinator owns acceptance and the parent index.

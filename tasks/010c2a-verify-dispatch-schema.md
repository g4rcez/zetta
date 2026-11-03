# RFC-010c2a: Actual dispatch schema proof

Status: actual structural proof accepted after worker49390 and coordinator29256 each passed56scenarios, exited0 and completed exact owned-service cleanup. [Coordinator review](../docs/reviews/dispatch-schema-010c2a-review.md). Parent010 remains incomplete.

Prerequisites: accepted [010c1 decision](../docs/decisions/dispatch-storage.md), [010c2 schema](010c2-implement-dispatch-schema.md), existing guarded run proof lineage. Root owns fixed launcher mode addition and its tests; this worker did not edit the launcher or any accepted helper/schema/migration.

## Owned source

- `packages/db/src/dispatch-proof-client.ts`: validates exact folder/file sets and SHA256 of both SQL files/both snapshots before reusing openRunProof. Applies dispatch through the already-reserved owner client, then requires exactly18 public tables. No new pool, cleanup deletion or migration repinning.
- `apps/server/src/modules/runtime/dispatch-schema.integration.ts`: inert import and target guard,120second whole deadline including setup/import/close, synthetic fixtures, parameterized SQL helpers, constraint-specific savepoint oracles, fixed-safe phase output, and accepted sticky new-IO guard after baseline/migrations/reserved clients. Three existing clients only; no concurrent query queue on one client.
- `dispatch-schema-cases.ts`: S1 positive commits/A+B/activate+input, independent-client canonical text/digest and owner/run/lease readback; S2 FK/unique controls; S3 bounds/closed initial states/pairs. Negative insertion cases first prove their unchanged positive row can insert, roll that insertion back, then mutate the tested field/pair and require exact SQLSTATE/constraint.
- `dispatch-schema-transitions.ts`: S4 immutable identities, sticky facts, revision rules, DELETE/TRUNCATE retention; S5 uncertainty/late acknowledgement, spent issue/cancel/expiry and exact no-op controls. One deliberate running-attempt structural release illustrates that SQL fields do not confer service authority.
- `packages/db/src/dispatch-proof-client.test.ts`: inert import, frozen pins, exact oracle discrimination and executable target rejection before setup.

All five source/test files are below250 nonblank lines. No runtime service or authority issuer is added.

## Counter and cleanup boundaries

A bounded temporary `revision_counter_probe` invokes the actual unchanged `public.dispatch_guard_revision()` at OLD int32 maximum and requires its named23514 failure. It is created inside a rolled-back transaction and never changes a public table/function/trigger. This is a function-branch control, not evidence of reaching that revision through billions of legitimate production updates. Ordinary dispatch rows separately prove initial/jump/overflow rejection.

Negative cases roll back their transaction/savepoint. The positive fixture commits two owned claims/four grants and intentionally retains those tombstones until the launcher disposes of its entire owned tmpfs service. The proof never deletes parent runs/members/accounts, disables guards or invokes the old eight-table cleanup. It closes all reserved clients. No zero-fixture-row claim is made.

## Proposed actual invocation and stop gate

After root adds/reviews its fixed mode and accepts this source freeze: `bash scripts/verify-identity-auth.sh dispatch-schema`, using only the existing dedicated owned identity-test tmpfs service and approved local image. Root must authorize the actual run separately. The source itself invokes no launcher and does not create a VM/container. Keep all proof/helper/launcher sources frozen during an actual run; retain failed receipts and complete exact service cleanup before diagnosis or changes.

Expect fixed PASS scenario names, final structural count/no-new-IO statement and reserved-client closure, followed by root launcher's exact disposal receipt. Mismatches reveal only expected-state/expected-constraint booleans; never raw errors/SQL/row values. Every negative requires the precise oracle, never any throw. Claim/service capacity races, authority issuance, genuine launcher settlement/native execution and backend cancellation integration are excluded.

## Offline preparation evidence

Evidence report: red-first failure retained; final4 tests/18 assertions pass; scoped strict exit0; all five LSP responses no diagnostics. An initial strict narrowing error was corrected by binding the validated ID before its async closure; its failed receipt remains retained. Actual SQL statements, trigger enforcement, server oracle ordering and service disposal are unexecuted and unclaimed.

## Actual worker run

Authorized command `bash scripts/verify-identity-auth.sh dispatch-schema`, exec49390, exit0 first run: all56 named structural scenarios passed without warnings or oracle mismatches. Reserved clients closed; owned Compose container and network were removed and exact cleanup passed. Committed tombstones remained until whole-service disposal; no parent deletes/zero-row claim or volume removal. Source/migration/launcher hashes matched after cleanup. Evidence: postgres-run-1.log/status/summary.json and postgres-run-1-source-sha256.txt in the linked evidence directory. Root independently repeats after this stable handoff.

# RFC-004c1: Guard the disposable identity test target

- **Parent:** [004c](004c-verify-identity-database-constraints.md), within root RFC-004.
- **Prerequisites:** accepted identity schema/services; no live database needed for this pure safety helper.
- **Status:** root RFC-004 row is authoritative; this child records evidence only.

## Goal

Provide a fail-closed configuration boundary before future identity integration tests create a Pool, execute SQL, migrate or tear down anything. This is preparation, not a live database proof.

## Non-goals

No database/driver instantiation, environment auto-loading, secret-file inspection, Docker command, migration/DDL, integration execution, install, production connection or promise that a URL label proves a database is disposable.

## Bounded paths and contract

Create only `apps/server/src/test-support/identity-test-target.ts`, its focused `.test.ts` and a small `docs/verification/identity-database.md` runbook. Existing identity integration test does not yet exist; this helper will be its mandatory entry boundary, not unused production configuration.

Use an explicit injected environment record, never read process.env during module evaluation. Require `ZETTA_TEST_DATABASE_URL` and a separate explicit `ZETTA_TEST_DATABASE_ALLOW_MUTATION=identity-tests` acknowledgement. No fallback to DATABASE_URL or services. Reject a target equal/equivalent to a supplied application DATABASE_URL without printing either. Restrict this first local-only harness to PostgreSQL protocols, loopback hosts (localhost, 127.0.0.1, ::1), a dedicated database name `zetta_identity_test`, and no query parameters/fragment or multi-host/path tricks. Later remote targets require a deliberate reviewed extension, not bypass flags.

Missing opt-in/target or malformed/unsafe input fails before any connection with a fixed non-sensitive error; never include a URL/credentials/driver error in error text/cause. Return validated target information only to the future test runner; do not log or stringify it. The guard performs no IO. Require operator confirmation that the dedicated database is empty/disposable; naming/loopback checks alone are not proof. Do not use persistent Compose database `zetta` or its volume.

Runbook must show placeholder-only variable setup, exact safety requirements and pending generator/migration/teardown approvals; clearly distinguish running guard unit tests from not-yet-implemented/not-yet-run PostgreSQL verification. Do not invent a passing database command, recommend a secret in shell history or authorize destructive cleanup. No environment file contents or credentials enter fixtures.

## Acceptance criteria

- [ ] Pure guard denies absent opt-in, missing target, application-equivalent URL, non-test name/remote host/protocol/query/fragment/path variants before IO, without sensitive diagnostics.
- [ ] Synthetic tests exercise accepted loopback URLs, canonical endpoint comparison and unsafe cases using no Pool/network or ambient secret reads.
- [ ] Runbook records the explicit disposable-target/operator prerequisites and planned use by 004c, without claiming that source checks or acknowledgment authorize a live run.

## Verification

Run `bun test apps/server/src/test-support/identity-test-target.test.ts` and targeted no-emit diagnostics. No DB, environment probes, provider, generator, migration, build or full suite. Independent review and coordinator confirmation accept source only.

## Definition of done and handoff

Export the narrow validated-target/error API and record exact commands, remaining live gates and how the future integration runner must invoke it before creating any client. Parent 004c stays incomplete until real evidence.

## Completion record

Status: source slice accepted after independent review, regression fix, coordinator checks and targeted re-review; this is not acceptance of live 004c verification. Parent 004c/root RFC-004 remain incomplete. Only this completion record is updated; parent/root status is untouched.

Approvals/prerequisites: user approved this pure guard, synthetic single-file Bun tests and targeted installed no-emit diagnostics, without any database environment approval/provisioning. Read 004c, ownership policy, task execution contract and accepted 004a/004b handoffs plus existing test support. Supervisor explicitly approved fail-closed rejection of an uncomparable supplied application URL (including query/fragment/multi-host forms), conservative equivalence of the three loopback spellings, and preservation of PostgreSQL database-name case. Final safety review identified omitted-port driver ambiguity; supervisor additionally approved endpoint-pinned output with explicit numeric/default port, while leaving driver/environment control to the separately approved future runner.

Changed paths:
- `apps/server/src/test-support/identity-test-target.ts` (new pure guard).
- `apps/server/src/test-support/identity-test-target.test.ts` (new focused synthetic tests).
- `docs/verification/identity-database.md` (new local-only safety/runbook and pending live gates).
- This child completion record only. No parent/root, manifest, lockfile, schema or production wiring edits.

Exported contract:
- `IdentityTestTargetEnvironment`: readonly injected record with optional `ZETTA_TEST_DATABASE_URL`, `ZETTA_TEST_DATABASE_ALLOW_MUTATION` and application `DATABASE_URL`; the function reads no ambient environment and has no imports/IO/logging.
- `requireIdentityTestTarget(env): IdentityTestTarget`: requires the explicit test URL and exact `identity-tests` acknowledgement; no service/application fallback. Returns only a frozen `{ connectionString }` for the future test runner, with the validated numeric/default port made explicit and URL-normalized spelling (not necessarily byte-identical input). This pins the same effective port used in comparison, preserving validated userinfo/host/database. The future consumer must use this value, never the original input; it must never be logged or stringified.
- `IdentityTestTargetError`: every denial/parser/injected-record failure becomes the fixed `Identity database test target is unavailable or unsafe.` message with no input/credentials or cause. Missing configuration is a thrown denial, not a passing skip.
- Target accepts only PostgreSQL protocol aliases, exact raw loopback host spellings (`localhost`, `127.0.0.1`, `[::1]`), optional valid numeric port and the exact raw `/zetta_identity_test` path. Raw controls/whitespace, queries/fragments, multiple hosts, encoded/alternate hosts and path variants are denied.
- Application comparison ignores credentials, protocol aliases, hostname case and default/numeric-port spelling; all three loopback hosts conservatively share one endpoint. Application IPv4 shorthand, expanded IPv6/trailing hostname dot and encoded database names cannot evade equivalence. Database names are never lowercased. A supplied application URL that cannot be unambiguously compared fails closed with the same safe error, rather than being ignored.

Commands/results (no database or environment setup commands):
1. `bun test apps/server/src/test-support/identity-test-target.test.ts`: initial run **8 pass, 1 fail**, 569 assertions. The isolated test attempted to redefine Bun's non-configurable `env` property; this was test instrumentation failure, not a guard failure. Removed that redefinition; retained a throwing `process.env` getter and static exclusion of any `Bun` reference in the guard.
2. Same exact single-file command after that correction: **9 pass, 0 fail**, 570 assertions (29 ms), Bun 1.3.14.
3. Following additional raw-control fixtures, same exact single-file command: **9 pass, 0 fail**, 588 assertions (91 ms), Bun 1.3.14. After approved endpoint-pinned output and explicit empty-credential fixtures, final same exact command: **9 pass, 0 fail**, 594 assertions (105 ms). No tests skipped. Output assertions cover explicit default/alternate/leading-zero ports and preserved validated endpoint/credential values; the injected record is unchanged. Cases cover accepted loopback formats, missing/non-exact acknowledgement, missing target/no fallback, malformed/remote/default target/path/authority/query/fragment variants, equivalent application endpoints despite auth differences and URL spellings, distinct ports/database case, uncomparable application inputs and safe unexpected failures.
4. `node_modules/.bin/tsc --version`: **Version 6.0.3**. Targeted strict diagnostics below ran three times, each exit 0/no output; no emit or incremental files:
   ```sh
   node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/test-support/identity-test-target.ts apps/server/src/test-support/identity-test-target.test.ts
   ```
5. The isolated Bun test subprocess uses `--no-env-file` with only synthetic `NODE_ENV=test`, throwing ambient-environment/network/startup/timer/logging hooks, then imports and invokes the guard for success and denial with empty output. A closed source assertion excludes all imports, ambient process/Bun access, clients and logging. These checks prove the source boundary only; no Pool/client/network or environment values are used by the guard.
6. LSP tools are unavailable; installed targeted TypeScript diagnostics were used instead. `git diff --check` passed; a bounded Python check of these four paths passed final-newline/trailing-whitespace/raw-NUL assertions. Scoped `git status --short --untracked-files=all -- <four paths>` showed only the intended files; overall status matched the pre-existing baseline. `git diff --cached --name-only` was empty; no files staged. Exact check details are also recorded in the implementation report; pre-existing unrelated changes are preserved. Independent review is pending and required for source acceptance.

Independent review follow-up: initial source review found P1 dot-only application paths (`.`, `..` and encoded combinations) normalized to an empty database path, allowing installed driver username fallback to evade application-equivalence denial. Coordinator added six regression cases with username `zetta_identity_test` and reproduced 8 pass/1 fail (595 assertions). The endpoint parser now rejects any normalized pathname that differs from the raw supplied database pathname. After the fix: `bun test apps/server/src/test-support/identity-test-target.test.ts` passed 9 tests/630 assertions (42 ms); the exact targeted strict diagnostic command above and `git diff --check` passed. Targeted independent re-review resolved the named P1 with no issues found and an OK verdict. Coordinator accepts this source-only slice. Review receipts: `/tmp/zetta-rfc004c1-review.md` and `/tmp/zetta-rfc004c1-followup-review.md`. No driver connection or database was used.

Limits/future entry point: the operator must separately supply and confirm an empty disposable local database, exact target and lifecycle; URL checks and an acknowledgement do not prove disposability or authorize mutation. Never use persistent Compose `zetta` or its volume. The future 004c runner must invoke this guard before importing/constructing any runtime client, Pool, migration runner or executor, supplying the application URL when configured and consuming only the returned endpoint-pinned connection string. The runner must explicitly control driver config/environment, including ambient PGUSER/PGPASSWORD for absent/empty credentials; pinning the port is not proof all ambient settings are neutralized. Remote/query-bearing configurations need reviewed extension, not bypass flags. Stop before generator/migration/live auth/constraint/concurrency/rollback/cleanup work until exact commands, output review, disposable environment and teardown are separately approved. No live database proof exists here; parent 004c/root remain incomplete.

Skipped by scope: database/Docker/network/provider calls, secret/environment inspection, actual environment setup, auth/schema generation, migrations, integration implementation/execution, builds/full suites, installs/dependency changes, production activation, auto-destruction, staging, commits or worktrees.

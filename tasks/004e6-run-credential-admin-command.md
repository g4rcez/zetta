# RFC-004e6: Run credential-creating installation operator command

Parent: [004e](004e-bootstrap-and-recover-installation-admin.md). Prerequisites: accepted 004e1–004e3, credential helper 004e4 and runtime credential proof 004e5. Root status is coordinator-owned.

## Scope and contract

User's v1 continuation and coordinator assignment authorize local source/focused validation. New `credential-operator.ts`, `credential-operator-cli.ts`, focused test, and runbook section compose only bootstrap/replacement. `packages/db/src/admin-operator-client.ts` now exposes inferred reserved-client Drizzle capabilities instead of a transaction-only annotation; owner, target readback, driver settings and cleanup are unchanged. Its existing source test checks the reserved Drizzle construction independently of annotation spelling.

The command imports inertly; static help and all target/input rejection precede driver/auth initialization. Shared target guard, non-TTY bounded fatal UTF-8 reader and 20-second hard deadline remain. Strict JSON accepts only credentials plus expected-old/reason for replacement. Ambient PG/native and any telemetry selector deny. Dynamic composition uses fresh private random secret, fixed `.invalid` URL, accepted credential provisioner and same owned connection; only verified success supplies the lifecycle ID. No adoption/retry/deletion, authority input, session creation or raw output.

Separate creation and activation commits intentionally leave a possibly unentitled account on activation failure. Generic phase-only errors and persistent health/close checks preserve uncertainty. Runbook explains approved reconciliation before deliberate subsequent action.

## Completion record

Status: source implemented; offline checks and real composition strict diagnostics pass. Follow-up [004e7](004e7-verify-credential-admin-command.md) now records six actual valid-target CLI scenarios, independently repeated by the coordinator with exact cleanup and exit0. Independent final review remains required. This source worker did not itself invoke DB/auth; the later proof is recorded separately.

Applied programming and Better Auth skills; read local task plan/intent/decision and prerequisite records. No relevant Zetta memory entry. Installed source confirms password hash delegates to `@better-auth/utils/password` with no application-secret argument (`better-auth/dist/crypto/password.mjs`, context password hash selection); telemetry package 1.7.7 uses environment OR options, requiring the new preflight denial.

Owned files: the three new identity credential-operator files, this RFC, appended runbook section, minimal DB annotation removal and corresponding existing source assertion narrowing. All unrelated dirty work preserved. No manifests/schema/app services/routes/auth source/shared launchers, production, installs, staging or commits changed.

Evidence manifest: `local evidence`.

Focused command: `bun --no-env-file test apps/server/src/modules/identity/credential-operator.test.ts apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.test.ts`: 31 pass, 0 fail, 412 assertions. Initial new test fails on missing module; a later combined run exposed the old annotation spelling assertion, then the full focused command passed after narrowing that assertion to actual reserved construction.

Strict command: `packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/credential-operator.ts apps/server/src/modules/identity/credential-operator-cli.ts apps/server/src/modules/identity/credential-operator.test.ts packages/db/src/admin-operator-client.test.ts`: exit 0. This includes actual installed credential factory and reserved-client DB composition without assertions/suppressions.

Next consumer: approved disposable actual CLI proof must run bootstrap and replacement through subprocess stdin, assert fixed output/exit status and account/admin/audit/session results, duplicate/stale/activation-failure outcomes and cleanup. Do not claim credential CLI runtime acceptance from these offline seams or the earlier helper-only proof.

# RFC-004e4: Provision trusted-operator credentials

- **Parent:** [004e](004e-bootstrap-and-recover-installation-admin.md).
- **Prerequisites:** [004e1](004e1-implement-admin-lifecycle-transactions.md), [004e2](004e2-run-existing-account-admin-command.md), [004e3](004e3-verify-existing-account-admin-command.md).
- **Scope:** supported account creation for trusted local operator composition. No public registration bypass, product factory change, schema change, admin plugin, direct hash/account insert, or membership authority.

## Contract

`packages/auth/src/operator-provisioning.ts` exports `createOperatorCredentialProvisioner(config, database)`, returning `(input: unknown) => Promise<OperatorProvisioningResult>`. Configuration explicitly supplies `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET`; the database requires only `select`, `insert`, `update`, `delete`, `transaction`, and `query`, compatible with Drizzle on a reserved PoolClient. Construction and invalid input are inert.

Strict input has only `name`, `email`, `password`: trimmed nonempty name up to 200 characters, valid email up to 254, password 8–128 characters. Better Auth 1.7.7 additionally owns validation, hashing, generated user ID and credential linkage. The never-mounted dedicated instance calls only `auth.api.signUpEmail({ body: { name, email, password } })`, without headers, callbacks or extra authority. It uses the installed relations-v2 adapter with transactions enabled, `autoSignIn:false`, `disableSignUp:false`, no plugins, disabled logger and disabled telemetry.

A resolved signup alone is insufficient: installed Better Auth 1.7.7 `dist/api/routes/sign-up.mjs` returns synthetic successes for existing email and some hook denials. Verification queries the exact returned ID AND lowercased requested email, requires exactly one account with matching owner/account ID and credential provider, SQL-projected password-present boolean, and no sessions. It never resolves an existing email to a substitute user ID. Hashes and session tokens are excluded from readback projections. Success contains only `{ok:true,userId}`; failure contains only `{ok:false,code}`, where code is `invalid_input` or `provisioning_failed`.

`provisionOperatorCredentials(input, dependencies)` exposes the same bounded orchestration for focused deterministic tests. Trusted dependencies comprise signup and minimal safe readback. This seam is internal composition, not a route or public signup factory.

## Completion record

Status: source implemented and focused offline verification passed; real credential provisioning, CLI integration and independent review remain pending at this handoff. Parent RFC-004/004e remain incomplete.

Authority: user's 2026-10-22 continuation through remaining v1 work; coordinator assigned these two new auth files and this RFC. Prerequisite lifecycle and reserved-client contracts remain unchanged. Read task execution rules, plan, confirmed intent and 004e1–004e3 handoffs. Applied programming and installed-version Better Auth skills; verified synthetic-success behavior directly in installed 1.7.7 source. No memory registry match for Zetta.

Changed paths:

- `packages/auth/src/operator-provisioning.ts`
- `packages/auth/src/operator-provisioning.test.ts`
- `tasks/004e4-provision-operator-credentials.md`

Evidence manifest: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G001-preserve-all-existing-tracked-untrac/a1/credential-source-evidence.md`.

Focused invocation:

```sh
bun --no-env-file test packages/auth/src/operator-provisioning.test.ts packages/auth/src/index.test.ts packages/auth/src/invitation-policy.test.ts apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.test.ts
```

Result: **64 pass, 0 fail, 491 assertions**, five files. Artifact `credential-source-tests.log` under the evidence manifest's directory. Covers bounded signup forwarding and opaque success, all malformed/extra-authority input cases before dependencies, exact limits, synthetic duplicate/ID/email mismatches, missing/multiple/wrong credentials, unexpected sessions/token, single-attempt opaque errors, and fresh-process inert import/construction/rejected input with network/timer guards. Existing auth policy, operator and ownership fixtures also pass.

Strict diagnostics:

```sh
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch packages/auth/src/operator-provisioning.ts packages/auth/src/operator-provisioning.test.ts
```

Result: exit 0, recorded in `credential-source-types.log`. Source LSP: no diagnostics, recorded in `credential-source-lsp.log`. No assertions, suppressions, direct credential writes or new dependencies.

Failure/recovery: no automatic retries or deletion. Account creation and existing membership/admin lifecycle remain separate transactions. Failure after creation may leave an unentitled account. The operator must inspect a failed/uncertain outcome before a deliberate subsequent action; an existing email is never silently adopted. Only the coordinator's separate integration invokes the lifecycle with the verified ID.

Next consumer: CLI integration and fresh disposable live proof must establish actual library password verification/signin, exact safe output, duplicate-account preservation, no sessions/authority at provisioning, transaction rollback on credential-link failure, and lifecycle integration. These focused fixtures do not claim actual hashing, PostgreSQL transaction behavior or login. No actual auth/context/API/DB execution occurred in this source slice. No production, installs, migrations, commits, staging or worktrees.

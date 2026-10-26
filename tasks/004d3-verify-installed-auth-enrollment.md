# RFC-004d3: Verify installed-auth enrollment

- **Parent:** [004d](004d-gate-auth-signup-with-invitations.md), within RFC-004.
- **Prerequisites:** accepted SQL-only [004c](004c-verify-identity-database-constraints.md) (14 checks), inactive [004d1](004d1-define-invitation-signup-preflight.md) and [004d2](004d2-inject-invitation-policy-into-auth-factory.md).
- **Status:** accepted bounded installed-auth proof after live execution and independent final evidence review. **Parent004d and RFC-004 remain incomplete.**

## Scope and prepared paths

- `apps/server/src/modules/identity/signup.integration.ts`: 251-line explicit, inert-on-import standalone proof; never automatic native test discovery.
- `apps/server/src/modules/identity/signup.integration.test.ts`: focused offline guard/import/source and compile-only fixtures.
- `scripts/verify-identity-auth.sh`: complete dedicated Compose/environment/proof/cleanup launcher.
- `scripts/verify-identity-auth.test.ts`: shell-control fixtures and actual metadata-predicate regressions.
- This task and [auth runbook](../docs/verification/identity-auth.md).

No production auth/services/callsite, SQL14 runner/fixture, schema, migration, infrastructure-configuration, dependency or lockfile changes. No builds or installs. The accepted root auth implementation is unchanged. Runtime auth was separately approved by the user for this dedicated disposable proof; source acceptance alone does not grant runtime or production authority.

## Installed source and narrow decisions

Read the accepted SQL14 lifecycle, guard/client, enrollment/admin lifecycle services, concrete preflight and auth options/policy, installed lockfile/source/public types, and local Better Auth/version, security and credential skills. Installed Better Auth/core/relations-v2 adapter: **1.7.7**. Local sources, not latest documentation, are authoritative.

1. `auth/base.mjs` invokes `initFn(options).then(...)` immediately. All real `betterAuth` construction and `$context` awaits are inside the guarded main, **after** `openIdentityProof` succeeds; fixture and gated contexts are initialized sequentially and immediately awaited. Pure `createAuthOptions` supplies the accepted adapter, cookies, credentials and session/origin defaults. `createAuth` is deliberately not used because it has no logger/telemetry test switches; no switch is added to production API.
2. Public core `types/init-options.d.mts` supports `logger` and `telemetry.enabled/debug`; public `env/logger.d.mts` supports `disabled`. Only those options are overlaid: logger disabled, telemetry enabled/debug false. Installed router `onError` respects disabled logger. No error, stack/cause, secret, cookie, SQL bind/result or auth body is serialized to output.
3. Installed `context/create-context.mjs` defaults `skipOriginCheck` to true when `isTest()` is true; origin middleware then also bypasses legacy CSRF. Core `env/env-impl.mjs` treats NODE_ENV=test or any nonempty TEST other than literal `false` as test (including TEST=0). Supervisor approved fail-closed **rejection**, not rewriting/unsetting these variables or overriding advanced security options. Target guard runs first. Tests cover both sentinel families and permitted non-test values. Runtime asserts both context skip flags are false.
4. Installed `@better-auth/telemetry/dist/index.mjs` ORs ambient BETTER_AUTH_TELEMETRY with configured enabled, and ambient DEBUG with configured debug. Enabled init tracking can detach a promise. Supervisor approved conservatively rejecting **every BETTER_AUTH_TELEMETRY-prefixed environment key**, even empty/unknown, before runtime imports; configuration false alone is insufficient. No ambient values are printed or silently cleared.
5. Production Database type includes `$client: Pool`; the accepted proof uses a reserved `PoolClient`. Supervisor approved proof-local `const adapterDatabase: Omit<Database, "$client"> = firstDb` assignment to check all other members, and one documented `as Database` at the options call. Installed relations-v2 code never reads `$client`; actual ORM still uses the reserved client. No fabricated Pool, new connection, production signature change, unknown cast or context/hook assertion.
6. `api/routes/sign-up.mjs` parses `z.object(...).and(z.record(...))`; actual JSON `invitationToken` remains in endpoint context. Core `api/index.mjs` runs handlers through endpoint context; `db/with-hooks.mjs` invokes create-before and returns null before adapter create on false. Installed signup maps null to **400**, `{code:"FAILED_TO_CREATE_USER",message:"Failed to create user"}`. These source-derived assertions passed in the actual live proof.
7. Supported `/sign-up/email` handler on a separate unexposed legacy composition provisions only a synthetic operator fixture using installed password hashing/linking. Its session is signed out, then accepted `bootstrapExistingAccount` selects its returned ID. No credential/user INSERT or manual hashing. This is **fixture-only**, not approval of production operator provisioning. Invitations are issued by the enrollment service, and the gated auth uses the **real concrete preflight** on the same reserved DB.
8. Installed `api/routes/session.mjs` consults stored sessions with default cookie cache disabled. `sign-out.mjs` deletes stored session and expires cookie. Cookie source derives `__Secure-better-auth.session_token` from HTTPS and preserves accepted Secure/HttpOnly/SameSite=None. No cookie/CSRF/origin/session/password bypass or modified hashing.

## Five-check live contract (executed)

Exact labels/count and lifecycle are in the runbook. The proof is one sequential fixture scenario: library-provision operator, bootstrap through service, issue invitation; four isolated denial inputs with exact unchanged counts; real JSON signup creates account/session without consumption/membership/admin change; session-authenticated acceptance first rejects revoked preflight invitation then accepts a fresh invitation; untrusted-origin and navigation-CSRF denials; trusted web/desktop signin/logout, stored-session replay denial, cookie attributes. No fake-verifier path is counted as real evidence (none added).

Preflight cannot grant domain authority. Acceptance uses a user ID checked against a real `/get-session` response, rechecks under service transactions, and alone consumes/activates. No public enrollment endpoint or production authorization gate is introduced.

Target/empty-state/hash/identity controls and eight-table cleanup/close are reused unmodified from `openIdentityProof`. Fresh dedicated tmpfs service is required for **each** SQL or auth command; they must not run against the same already-migrated instance. SQL14 remains its own accepted evidence, not rerun or counted here. New socket/DNS/fetch/listener entrypoints are denied after all three proof connections are reserved, before auth imports, and an attempted-but-swallowed outbound failure also fails the run. These hooks are defense in depth, **not a firewall**. The hard 90-second deadline remains armed through fixture cleanup/Pool.close; all outer failures use finite phase-only messages.

## Offline verification record

TDD RED: `bun --no-env-file test apps/server/src/modules/identity/signup.integration.test.ts` exited1 with expected missing `./signup.integration`, 0 pass/1 fail/1 error. No auth factory ran.

Initial GREEN: 3 pass/32 assertions; initial strict compile correctly found the Pool versus PoolClient `$client` mismatch. After the approved structural witness and environmental telemetry protection, final focused commands:

```sh
bun --no-env-file test apps/server/src/modules/identity/signup.integration.test.ts
# Bun 1.3.14: 3 pass, 0 fail, 44 expect() calls.
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/signup.integration.ts apps/server/src/modules/identity/signup.integration.test.ts
# Installed TypeScript 6.0.3: exit0, no diagnostics/output artifacts.
```

The test imports the new module inertly, uses the pure target/environment helper with synthetic records, and spawns only a **missing-target** entry with throwing socket/DNS/HTTP/fetch/listen/timer hooks. Exit1/fixed stderr/empty stdout prove fail-closed startup without real client/auth initialization. Type-only runner/config/database imports are erased. Source assertions check post-open auth imports, options, no production imports or security overrides, installed version/test-mode/null-create behavior and cleanup/deadline presence. No factory/context/handler/API is called in offline tests.

Independent auth source review `/tmp/zetta-rfc004d3-review.md` and initial launcher review `/tmp/zetta-identity-auth-launcher-review.md` found no issues. After user approval, coordinator added the complete launcher and tests. Final combined focused verification passed **9 tests/95 assertions**:6 launcher tests/51 assertions plus3 original offline proof tests/44 assertions. Launcher control tests use fake commands; metadata regression separately executes the actual predicate. Neither is counted as live auth evidence. Strict no-emit diagnostics over all3 TypeScript paths, Bash syntax and whitespace checks passed. LSP tools unavailable; no full-project check/build or broad suites.

## Live execution record

`bash scripts/verify-identity-auth.sh` passed **all five real installed-auth checks**, the post-close summary and scoped teardown with **exit0**. The fresh dedicated PostgreSQL18 image ID was `sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6`; actual filesystem probe confirmed tmpfs. Independent post-run project container/network/volume queries were empty. The existing application database was not targeted or restarted.

Two earlier attempts stopped before auth/DB proof initialization because the launcher's nonempty-Mounts expectation was wrong: Docker declared tmpfs in HostConfig while Mounts was empty. Both attempts cleaned up. The actual-predicate regression failed before the correction and passed after it; required tmpfs declaration and bind/volume rejection remain, with a new live filesystem check. No auth/security assertion was weakened.

Fixed labels and scope are in the [runbook](../docs/verification/identity-auth.md); safe detailed receipt is `/tmp/zetta-rfc004d3-live.md`. Compose progress on stderr is expected; no credential/body/cookie/raw cause was emitted. Final independent review `/tmp/zetta-rfc004d3-final-review.md` found no issues and recommends accepting this bounded installed-auth proof; coordinator accepts it.

## Remaining gates

Production composition/access/UI/operator tooling under the applicable approval boundaries. Browser cookie transport/CORS, actual desktop protocol transport, DNS/TLS/HTTP listener/proxy forwarding, providers/email, enumeration/rate limiting, races and production deployments are not proved by in-process Request handling. Parent004d/RFC-004 remain incomplete despite this bounded five-check success.

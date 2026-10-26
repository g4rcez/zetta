# RFC-004d2: Inject invitation policy into the auth factory

- **Parent:** [004d](004d-gate-auth-signup-with-invitations.md), within root RFC-004.
- **Prerequisite:** accepted inactive [004d1](004d1-define-invitation-signup-preflight.md) policy/verifier source.
- **Status:** inactive source slice accepted after independent review and coordinator focused checks. Parent 004d and root RFC-004 remain incomplete.

## Goal and boundaries

Prepare explicit, trusted-server-only invitation verifier injection into the existing auth factory without activating production closed enrollment. Preserve existing callers and auth configuration. No identity SQL/probe/schema changes, server wiring, DB/client/connection, Docker, network/provider/auth endpoint calls, dependencies, migrations, builds or full suites.

## Source contract

Changed source: `packages/auth/src/index.ts`. Added focused tests: `packages/auth/src/index.test.ts`. Documentation changes are this child and the parent 004d completion link only.

- `AuthFactoryOptions = { invitationSignupVerifier: InvitationSignupVerifier }`: required verifier whenever the optional fourth options object is supplied. No arbitrary hooks, frontend mode flag or default allow callback.
- `createAuth(env, database, desktopOrigins = [], options?: AuthFactoryOptions)` remains source-compatible with existing two/three-argument calls. It delegates directly to `betterAuth(createAuthOptions(env, database, desktopOrigins, options))`.
- `createAuthOptions` has the same parameters and assembles the exact configuration without constructing Better Auth. Its inferred return uses `satisfies BetterAuthOptions`, not a broad return annotation. This is the narrowly approved pure configuration/testing seam, not another runtime factory or client API.
- Only `options === undefined` preserves the legacy configuration with **no databaseHooks property**. This is deliberately NOT v1 closed-enrollment activation. Explicit null/empty/nonfunction callback options arriving outside TypeScript still install the policy, which denies at invocation. No truthy/falsy mode selection can silently omit the gate for such values.
- Explicit options install only `databaseHooks.user.create.before = createInvitationSignupPolicy(options?.invitationSignupVerifier)`. Existing policy remains unchanged: nullable/missing/malformed context, wrong path, invalid account/token, verifier false/nonboolean/exception or absent callback returns false; true preflight returns void without replacement user data, membership or consumption.
- Adapter remains the installed relations-v2 Drizzle adapter with provider `pg` and **auth-only** `@zetta/db/schema/auth`. No identity schema or invitationToken user field is added. Email/password remains enabled; trusted web/desktop origins, secret, baseURL, secure/httpOnly/SameSite=None attributes and empty plugins are preserved. `Session = ReturnType<typeof createAuth>["$Infer"]["Session"]` is unchanged; strict compile fixtures check legacy call compatibility and equivalent Session inference with the hook-free configuration.
- Public installed `BetterAuthOptions` and existing `InvitationSignupVerifier`/`InvitationSignupBefore` types only. No production assertions or invented hook context shape. Synthetic partial contexts are passed via Reflect.apply and explicitly do not establish runtime endpoint compatibility.

## Installed-version evidence and approved fallback

Read local Better Auth/version and security skills, accepted 004d/004d1 records, policy/verifier source/tests, accepted app/forwarding fixtures and installed source/public types. Lockfile and installed package resolve Better Auth/core/Drizzle adapter **1.7.7**; no latest-version docs/generator or install was used.

Important installed evidence: `better-auth/dist/auth/full.mjs` directly returns `createBetterAuth(options, init)`. `auth/base.mjs` immediately executes `const authContext = initFn(options).then(...)` before returning the object containing `options` and `$context`. Thus calling the real factory and inspecting only `.options` would **still initialize auth context**. It is not lazy in installed 1.7.7. `context/init.mjs` starts adapter/context setup. No real createAuth/betterAuth invocation is used in these tests.

Escalated this concrete conflict before implementation. Supervisor explicitly approved the minimal same-module `createAuthOptions` helper, direct factory delegation, inferred `satisfies BetterAuthOptions` return, no global/module mocking and config-only tests. No policy/product decision was reopened.

Installed public core `types/init-options.d.mts` declares the user-create-before hook with nullable `GenericEndpointContext` and false/void/data return. Existing policy derives directly from that public type. Existing focused policy test rechecks installed signup body passthrough, context propagation source and false-aborts-create source. These source assertions do not prove an actual signup or user-write prevention.

## Verification record

TDD RED, before production edits:

```sh
bun test packages/auth/src/index.test.ts
```

Expected exit 1: missing `createAuthOptions` export; 0 pass, 1 fail, 1 error. No real auth factory ran.

After implementation, first GREEN: same command, **5 pass, 0 fail, 46 assertions**. Expanded invalid-option primitive coverage and static factory/Session compatibility checks; final commands with Bun **1.3.14**:

```sh
bun test packages/auth/src/index.test.ts
# 5 pass, 0 fail, 49 expect() calls (147 ms)
bun test packages/auth/src/invitation-policy.test.ts
# 6 pass, 0 fail, 60 expect() calls (8 ms); unchanged policy regression file
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch packages/auth/src/index.ts packages/auth/src/index.test.ts packages/auth/src/invitation-policy.ts packages/auth/src/invitation-policy.test.ts
# TypeScript 6.0.3: exit 0, no diagnostics, no emit/incremental output
```

The five new focused tests cover legacy configuration keys/values, original two/three-argument factory type compatibility, required verifier/Session inference, exact create-before placement and normalized delegation, fail-closed invalid/missing callback and malformed/nullable context, offline import/config assembly, and installed eager initialization/direct factory delegation evidence. Existing policy tests retain the detailed token/authority/account/exception matrix rather than duplicating it.

Configuration assembly uses a throwing test-only proxy typed as Database, not a client or connection; the real installed adapter closure is constructed but never invoked. The subprocess uses `--no-env-file`, an environment containing only NODE_ENV=test, and throwing Bun/TCP/TLS/fetch/listen/timer guards before importing the source and assembling legacy/gated configs. It exits 0 with empty stdout/stderr. No auth context, handler, session or endpoint is initialized. No secrets/config/diagnostic causes are serialized by the tests.

Bounded tracked/new-file whitespace checks passed. `git diff --cached --name-only` is empty; no staging or commits. LSP tools are unavailable; targeted installed diagnostics are not a full-project check/build. Unrelated pre-existing working-tree changes are preserved.

## Later consumers and remaining gates

After accepted real disposable installed-auth/DB evidence and review, trusted server composition can create the existing `createInvitationSignupPreflight(database)` and pass it as the fourth argument's `invitationSignupVerifier` to createAuth, retaining current desktop origins. **No services.ts, server index.ts or other production call site is changed here.** Existing callers still omit the options and retain the legacy behavior, not the v1 enrollment gate.

Later installed-auth proof must exercise actual JSON invitationToken retention, endpoint context, denial/error/user-write paths, valid preflight account creation without membership/consumption, and existing signin/logout/forwarding/cookie/session/trusted-origin compatibility. No such HTTP/auth/cookie/session/runtime evidence was run or claimed here. Accepted original app forwarding fixtures were read, not rerun; their synthetic auth handler is not installed-auth proof. Identity SQL verification belongs to the coordinator's separate accepted path and is not changed or counted as this slice's evidence.

The callback remains only a preflight snapshot: authenticated 004b/004f acceptance must recheck and atomically consume/write membership/audit; successful account/session creation conveys no domain authority. Existing-user-bound invitations still require signin plus authenticated acceptance. Operator provisioning remains separate. Independent review `/tmp/zetta-rfc004d2-review.md` found no issues. Coordinator reran `bun --no-env-file test packages/auth/src/index.test.ts` (5 pass/49 assertions) and policy tests (6 pass/60 assertions), the exact targeted strict no-emit diagnostics above and whitespace checks; all passed. This inactive source slice is accepted; **004d and RFC-004 stay incomplete** until the remaining runtime and production-integration gates are satisfied.

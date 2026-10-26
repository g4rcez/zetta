# Installed-auth enrollment proof

[004d3](../../tasks/004d3-verify-installed-auth-enrollment.md) prepares a standalone installed Better Auth **1.7.7** + PostgreSQL proof. Independent source review found no issues (`/tmp/zetta-rfc004d3-review.md`); coordinator offline3 tests/44 assertions, strict diagnostics and whitespace checks passed. The user explicitly approved creating and running the complete disposable launcher. The actual five-check proof, post-close summary and scoped teardown passed with exit0; final independent review found no issues and this bounded proof is accepted. This approval does not authorize production wiring. Root RFC-004 and parent004d remain incomplete.

## Boundary and prerequisites

Read [identity database runbook](identity-database.md) for the accepted dedicated ownership/private-credential/provisioning/teardown recipes. Use that lifecycle **unchanged**: explicitly selected `docker-compose.identity-test.yml`, project `zetta-identity-tests`, service `postgres`, throwaway private password, tmpfs PostgreSQL18, database `zetta_identity_test`, role `zetta_identity_runner`, endpoint127.0.0.1:55432, exact marker/data-directory/owner checks. Do not use root Compose, application services, persistent volumes, app env autoload, schema push, a migration CLI, URL fallback or a different port/DB. The implementation worker prepared source only; coordinator subsequently ran the approved lifecycle.

- Obtain a **fresh empty dedicated instance for this one command**. SQL14 and auth proofs are separate; never run auth against the previously migrated SQL14 target, even though both use the same dedicated service definition. Recreate only that project's disposable tmpfs service between commands; never drop/reset schema or migration journal.
- Supply the accepted opt-in `ZETTA_TEST_DATABASE_ALLOW_MUTATION=identity-tests` and explicit private `ZETTA_TEST_DATABASE_URL` as described in the database runbook. Preserve a configured application `DATABASE_URL` for comparison; never unset it to evade guard checks. No PG-prefixed key or NODE_PG_FORCE_NATIVE is allowed.
- Use a deliberate non-test environment, e.g. **NODE_ENV=development**, without TEST and without **any BETTER_AUTH_TELEMETRY-prefixed key**. The runner rejects NODE_ENV=test and any nonempty TEST except literal `false`; TEST=0 also means true in installed code. It never rewrites/unsets these inputs. The command is **not** `bun test`. Installed production mode enables its default three-per-ten-second sensitive-path rate limit; no rate-limit override is installed, and production throttling is not the purpose of this development proof.
- Run without preloads/instrumentation/application bootstrap and without secrets/providers. Bun `--no-env-file` prevents Bun dotenv autoload, not caller-supplied preloads; the operator must control the invocation environment. Do not use an application env loader, Axiom, service composition or debug logging.
- Target guard runs before runtime imports or deadline setup. Installed Better Auth eagerly initializes contexts; no real auth object is constructed until **after** accepted `openIdentityProof` verifies all reserved connections, target emptiness and pinned migration.

## Focused offline checks

```sh
bun --no-env-file test scripts/verify-identity-auth.test.ts apps/server/src/modules/identity/signup.integration.test.ts
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch scripts/verify-identity-auth.test.ts apps/server/src/modules/identity/signup.integration.ts apps/server/src/modules/identity/signup.integration.test.ts
```

These checks passed9 tests/95 assertions (launcher6/51, original proof guards3/44), strict no-emit diagnostics, Bash syntax and whitespace checks. Launcher control-flow tests use fake Docker/Bun; the metadata test separately executes the actual predicate over synthetic JSON. They invoke no real auth factory/context/handler/API. It checks pure synthetic target/environment records, inert import/source order, installed contracts and types. The only runner subprocess has **no target** and all network/startup/timer hooks throw. Expected fixed denial: `Identity auth proof failed at target validation; details suppressed.` Exit1 is required, not a skip. This is not evidence that runtime auth requests, database mutation, cookies or successful cleanup work.

## Run the complete disposable lifecycle

From the repository root:

```sh
bash scripts/verify-identity-auth.sh
```

The launcher creates private throwaway credentials and the explicit target/acknowledgement, defaults an absent or empty `NODE_ENV` to development, validates the environment before provisioning, and refuses existing project containers, networks or volumes. It uses only the already-local image (`--pull never`), verifies dedicated ownership/health/loopback port/tmpfs-only storage plus an actual filesystem-type probe, executes the proof, and tears down only the selected project on normal success or failure, INT or TERM. It preserves a failed proof exit status and confirms container/network removal. Use one trusted operator/run at a time; forced process/host loss and a stalled Docker daemon are not recovery guarantees.

The inner command is not self-contained; running it without the launcher-supplied environment fails at target validation before IO:

```sh
bun --no-env-file ./apps/server/src/modules/identity/signup.integration.ts
```

No credentials in argv, rendered config, shell trace, env dump or diagnostic cause. Application `DATABASE_URL` and rejected environment selectors are preserved, not silently removed. The launcher does not use the persistent application database or root Compose.

The command calls accepted `requireIdentityProofTarget` first, through a pure environment wrapper. `openIdentityProof` remains unchanged: three max-one pools with all verified backends reserved, advisory ownership lock, empty-target check, exact migration directory and SQL SHA-256 `2277a1d657eb88cd98de5ee99a46af70243c22350ae4a53bdb19d606bf46a2d4`, installed migration runner, no unguarded apply. Identity/eight-table cleanup is performed before fixtures and in finally, even if auth construction/context fails; all clients/pools close under the same hard **90-second** deadline. No fixture DDL, hand-inserted credential/user, schema change or fault constraint is added by this runner.

After reservation, before auth imports, a small local guard throws on new Node sockets/listeners/TLS, DNS lookup/resolve (callback/promise), HTTP(S) request/get, Bun connect/listen/serve and global fetch. Existing verified DB sockets continue working. Any attempted outbound marks failure even if a dependency catches its exception. Patches are restored after close; all test-owned async operations are awaited. **Not a firewall or comprehensive OS egress isolation claim.** No HTTP server/listener, DNS/browser, provider/email callback, external URL fetch or real credential is intended.

## Fixture and security configuration

Synthetic HTTPS base `https://auth.identity.invalid`, trusted web `https://web.identity.invalid` and desktop fixture `https://desktop.identity.invalid`; rejected origin `https://untrusted.identity.invalid`. These are Request strings only, never contacted. A random synthetic auth secret/password and invitation tokens exist only in memory. No response body, cookie, token/hash, bind/result, URL credentials, stack or error cause is printed. PASS/error output is fixed labels only.

The runner uses pure `createAuthOptions` + real installed `betterAuth`. It does not use direct `createAuth` because that production API deliberately lacks logger/telemetry runtime switches. Only public test-local `logger:{disabled:true}`, `telemetry:{enabled:false,debug:false}` are overlaid. Installed telemetry also ORs in ambient telemetry flags, hence conservative pre-import environment rejection. Cookies, credentials hashing, session defaults, origin/CSRF checks, auth-only adapter/schema and plugins remain the accepted configuration. Runtime skip-origin/CSRF flags must both be false. No security relaxation to pass tests.

A proof-local structural assignment checks the reserved DB against `Omit<Database,"$client">`; the one `$client` assertion at options assembly is documented because production type expects Pool while the proof owns a reserved PoolClient. Installed relations-v2 never reads `$client`. No fake pool or new connection is created, and production signatures remain untouched.

A separate **unexposed legacy in-memory composition** on that guarded DB performs supported library `/sign-up/email` provisioning for one synthetic operator account; installed Better Auth hashes/links credentials. Its session is signed out. The accepted admin service then bootstraps that selected existing ID; enrollment service issues invitations. This fixture-only use is **not** a production operator provisioning tool, invitation bypass in the gated auth, or approved public route. The subsequent gated composition always uses `createInvitationSignupPreflight(firstDb)`; no fake verifier/hook/context injection is counted.

## Verified live receipt: five fixed labels plus summary

Print each label only after its assertions and driver/outbound health checks pass. This is a sequential scenario sharing the same fixture, not five isolated resets:

```text
PASS signup denials precede user account session writes
PASS JSON invitation preflight creates credentials session without enrollment
PASS authenticated acceptance rechecks revocation then consumes and activates
PASS untrusted origin and cross-site navigation deny without writes
PASS trusted web desktop signin logout invalidate stored sessions and retain cookies
PASS installed auth enrollment proof (5 checks)
```

1. Missing token, malformed token, **valid token with wrong email**, and valid token with extra `role` each produce installed-source-derived400/FAILED_TO_CREATE_USER, no Set-Cookie, and exact unchanged `{users:1,accounts:1,sessions:0,members:1,consumed:0,audits:2}` plus unchanged admin pointer. Those counts include library-provisioned operator/bootstrap/invite issue. All these exact assertions passed in the live run.
2. Actual JSON `invitationToken` through the handler/context and real verifier permits signup, producing one new credential account, stored session and Secure/HttpOnly/SameSite=None session cookie. Counts become `{users:2,accounts:2,sessions:1,members:1,consumed:0,audits:2}`; admin unchanged. The live signup established actual body passthrough/context compatibility, unlike offline source assertions.
3. Real `/get-session` confirms the actor ID. Revoke the preflight invitation through service, then authenticated acceptance must fail without consumption or membership. A freshly service-issued invitation is accepted separately: exact consumer ID and active membership checked; `{users:2,accounts:2,sessions:1,members:2,consumed:1,audits:5}`, same admin. Preflight is only a snapshot and grants no domain authority.
4. Untrusted-origin signin and cross-site navigation signin produce403 with installed codes INVALID_ORIGIN and CROSS_SITE_NAVIGATION_LOGIN_BLOCKED. Cookie-bearing untrusted signout also denies403 and leaves session usable. Exact counts unchanged; no signin cookie. Origin/CSRF are not disabled by Bun test mode.
5. Logout invalidates the stored session (zero rows) and expires the secure/httpOnly/SameSite=None cookie; replay of the original cookie yields null session. Both trusted web and desktop fixture origins can then signin, obtain one stored session/correct cookie, get session and logout/replay-null again. Final counts `{users:2,accounts:2,sessions:0,members:2,consumed:1,audits:5}`, same admin. No cookie cache override.

Any missing/unsafe target, test-mode bypass environment, telemetry selector, setup/init/request/assertion/driver/outbound/cleanup failure exits1 with a finite phase label only. Deadline prints a fixed suppressed message and terminates; successful summary is emitted **after** fixture cleanup and pool close. Record exit status, exact label count and dedicated teardown separately; never record sensitive bodies or raw diagnostics.

Coordinator teardown remains exactly the accepted project-scoped database runbook `down --timeout 5` recipe, including after failure, while private Compose password remains supplied; then unset throwaway variables. No `-v`, broad prune, default Compose or persistent volume cleanup. Confirm only that dedicated project's container/network are gone. The coordinator independently confirmed zero project-labeled containers, networks and volumes after teardown. The existing application DB was not targeted or restarted.

## Live execution record

`bash scripts/verify-identity-auth.sh` exited0 after all five labels, the post-close summary and dedicated cleanup. The already-local PostgreSQL18 image ID was `sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6`. Ownership/port/health, declared tmpfs-only storage and actual `stat -f` filesystem type all passed. Compose progress on stderr is expected; no auth failure or sensitive diagnostic was emitted. Detailed safe receipt: `/tmp/zetta-rfc004d3-live.md`.

Two initial launcher attempts stopped before auth/DB proof initialization and both cleaned up. Docker29.5.2 reported tmpfs in `HostConfig.Tmpfs` with an empty `Mounts` array. A failing regression using the real predicate established the erroneous nonempty-array check; the corrected predicate keeps the declaration and rejects bind/volume mounts, while a new live filesystem probe requires exactly tmpfs. No auth/security check was relaxed. Final independent review `/tmp/zetta-rfc004d3-final-review.md` found no issues and supports acceptance of this bounded proof.

## What this does not prove

No browser CORS/credentialed cookie transport, TLS/DNS/HTTP listener, actual desktop webview/custom-scheme handling, proxy/header forwarding, external providers/email, production rate limiting/enumeration behavior, UI/domain access gate, production operator provisioning, production composition or deployment. In-process Request handling manually transfers a cookie string; it does not simulate a browser cookie jar or network. SQL14 remains separate accepted SQL/race evidence and is untouched. This bounded five-check pass does not complete004d/RFC-004 or authorize production wiring.

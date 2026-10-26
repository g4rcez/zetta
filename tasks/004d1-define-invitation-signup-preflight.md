# RFC-004d1: Define invitation signup preflight

- **Parent:** [004d](004d-gate-auth-signup-with-invitations.md), within root RFC-004.
- **Prerequisite:** accepted 004b source/service contract. Does not depend on actual DB execution for source fixtures.
- **Status:** parent RFC-004 row is authoritative; this child records evidence only.

## Goal

Prepare a fail-closed Better Auth signup preflight and concrete invitation-validation query, without changing production auth composition or consuming invitations.

## Non-goals

No createAuth/service wiring yet, database connection, public endpoint, real signup proof, email provider, plugin, dependency, migration or operator-account bypass.

## Bounded paths and contract

Use `packages/auth/src/invitation-policy.ts` and its focused test plus `apps/server/src/modules/identity/signup-preflight.ts` and its focused test. Inspect installed Better Auth 1.7.7 nullable user-create hook context/body APIs; derive types from installed public exports rather than inventing context. Export a narrow hook/policy constructor for later 004d activation; missing context or invalid account/token fails closed. Reserve an exact body token field only when supported by installed source and documented in the handoff. No default allow path, implicit admin privilege, token URL/logging or token consumption in preflight.

Concrete server-side verifier uses accepted invitation schema and actual Drizzle queries via existing `@zetta/db/query`. Validate canonical token/hash, lowercase email and exact existing-user restrictions. Unauthenticated creation cannot accept an existing-user-bound invitation as a new identity. Require current unexpired/unrevoked/unconsumed invitation using database time, and installation readiness as needed; approval/acceptance is still 004b's separate authenticated transaction. Avoid treating a successful preflight as membership or guaranteed later acceptance: revocation/expiry/races can still occur before authenticated acceptance.

No auth/db runtime imports during module evaluation. Source-only fixtures may use a narrow verifier callback and real Drizzle offline query-client boundary, but not fake production queries. Never call real auth/DB or weaken current cookies/origins.

## Acceptance criteria

- [ ] Hook/policy rejects missing/nullable context, missing/malformed token, mismatched account, injected role/authority and verifier failure; valid preflight does not consume or activate membership.
- [ ] Concrete verifier generates bound SQL for required invitation predicates and clock expiry; errors expose neither token/hash nor distinguishing account details.
- [ ] Focused tests validate installed hook contract and actual query generation without production wiring, and record actual API/body-field evidence and remaining live-auth proof.

## Verification

Run each created focused native Bun test, targeted no-emit diagnostics and whitespace review. No actual signup/database/provider/build/full-suite command. LSP absence must be explicit. Do not count callbacks/offline SQL as proof of installed endpoint body parsing.

## Definition of done and handoff

Record exported hook/verifier signatures, exact token body handling, expected integration call site and source-versus-runtime limits for 004d. Independent review precedes acceptance. 004d and root RFC-004 remain incomplete until real proof and production integration.

## Completion record

Accepted as an inactive source slice — independent source/installed-API review found no issues. Coordinator independently reran both single-file tests: policy 6 pass/60 assertions (81 ms), verifier 7 pass/74 assertions (125 ms), zero failures. This is only the inactive 004d1 source slice. Parent RFC-004 and 004d remain incomplete; no production integration is activated.

Approvals/prerequisites: user's bounded identity/auth source-work and native single-file Bun-test approval; accepted 004a schema, accepted 004b transactional enrollment and narrow `@zetta/db/query` helper contract; approved ownership policy. Read the installed-version Better Auth/security skills and TDD skill. No new policy, dependency, schema, helper export or environment decision was needed.

Changed paths:
- `packages/auth/src/invitation-policy.ts` (new): typed fail-closed user-create-before constructor.
- `packages/auth/src/invitation-policy.test.ts` (new): six focused native Bun policy/installed-source checks.
- `apps/server/src/modules/identity/signup-preflight.ts` (new): concrete read-only Drizzle verifier.
- `apps/server/src/modules/identity/signup-preflight.test.ts` (new): seven focused native Bun offline SQL/client/composition/import checks.
- Only this child's completion record. Existing unrelated edits/untracked paths were preserved; nothing staged. `createAuth`, auth/index, services, query helpers/exports, manifests, lockfiles and schema are untouched.

Exported source contract:
- `InvitationSignupBefore` derives directly from the public `BetterAuthOptions` export in `better-auth`, through `databaseHooks.user.create.before`. Installed 1.7.7 declares `(user: User & Record<string, unknown>, context: GenericEndpointContext | null) => Promise<boolean | void | { data: Optional<User> & Record<string, any> }>`; no internal-library imports, guessed context type or production type assertions are used. Its installed runtime may actually pass `undefined` outside endpoint context; the falsy-context check rejects both null and undefined.
- `InvitationSignupVerifier = (input: Readonly<{ token: string; email: string }>) => Promise<boolean>` is the only callback boundary. `createInvitationSignupPolicy(verify: InvitationSignupVerifier): InvitationSignupBefore` requires it statically and also denies a missing/nonfunction verifier at runtime. Only literal verifier `true` allows; denial/exception/nonboolean success returns `false`, never sensitive errors or replacement user data. Success returns void, leaving ordinary account creation to Better Auth.
- Policy permits only `/sign-up/email`, checks canonical 32-byte base64url token spelling (43 characters plus decode/re-encode equality), and matches the proposed account email against body email using lowercase-only normalization. Body allowlist is installed core signup fields (`name`, `email`, `password`, `image`, `callbackURL`, `rememberMe`) plus exact **`invitationToken`**. No URL/query/header fallback or alternate `token` field is accepted. Unknown authority fields in the body or proposed user are denied; `emailVerified` must be false. The installed endpoint remains responsible for its normal name/password/body validation. No role/membership is added, accepted or returned.
- `createInvitationSignupPreflight(db: Pick<Database, "select">): InvitationSignupVerifier` imports Database and the verifier type only, and uses existing side-effect-free DB query/schema modules. It validates the narrow input again, hashes the canonical token string with SHA-256 hex (same contract as 004b), and lowercases email without trimming or provider normalization.
- The verifier executes one bound Drizzle SELECT with a literal boolean projection and limit 1. It requires installation singleton ID 1 joined to its active admin membership, matching token hash/intended email, **NULL intendedUserId** (all exact existing-user-bound invitations require signin + authenticated acceptance), NULL revocation/consumption/consumer, and strict `expires_at > clock_timestamp()`. It has no application-clock check, transaction, lock, mutation, invitation/account projection, logging or error cause. Missing row or storage failure returns false identically.

Installed API/body-field evidence (local installed/lockfile-confirmed Better Auth **1.7.7**, Drizzle **1.0.0-rc.4**):
- `better-auth/dist/api/routes/sign-up.mjs`: `signUpEmailBodySchema` is `z.object({...}).and(z.record(z.string(), z.any()))`, so extra `invitationToken` is retained in the parsed endpoint body; handler uses `const body = ctx.body` and calls internalAdapter.createUser. This is an application-reserved body field supported by passthrough, not a built-in Better Auth invitation API.
- `@better-auth/core/dist/api/index.mjs`: endpoint handler runs through `runWithEndpointContext(context, () => handler(context))`.
- `better-auth/dist/db/internal-adapter.mjs`: createUser lowercases email and invokes createWithHooks with user data/timestamps.
- `better-auth/dist/db/with-hooks.mjs`: captures `tryGetCurrentAuthEndpointContext()`, invokes before as `toRun(actualData, context)`, and returns null before adapter creation when result is false. `@better-auth/core/dist/context/endpoint-context.d.mts` documents undefined when no endpoint context exists; runtime uses endpoint AsyncLocalStorage.
- `better-auth/dist/db/schema.mjs`: parseUserInput processes configured schema fields only. **Do not register invitationToken as user.additionalFields**, persist it or return it in account data.
- In installed email signup, false/null creation maps to generic FAILED_TO_CREATE_USER behavior (the endpoint currently throws BAD_REQUEST for a null create result). The policy itself returns only false/void and suppresses verifier exceptions. This does not remove preexisting Better Auth duplicate-email responses/logging or establish endpoint-wide enumeration resistance.
- Tests read these installed source/type seams and statically satisfy BetterAuthOptions. Context fixtures intentionally assert only partial path/body shapes to the exact installed parameter type; they do not create an auth instance or prove real endpoint parsing/context/error behavior.

Validation history and exact commands:
1. TDD RED: `bun test packages/auth/src/invitation-policy.test.ts` and `bun test apps/server/src/modules/identity/signup-preflight.test.ts` each exited 1 with the expected missing local production module (0 pass, 1 fail, 1 error per file), before implementation.
2. First implementation run: policy 5 pass/1 fail because the test context helper's default parameter replaced explicit undefined with a valid body; server 5 pass/1 fail because the isolated-import test used one too many parent segments. Corrected those test fixtures, not production policy. Targeted strict diagnostics already passed at this stage.
3. Next single-file runs: policy 6 pass, 0 fail, 59 assertions; server 6 pass, 0 fail, 68 assertions. Added direct hook+concrete-verifier offline composition coverage and the installed endpoint-context source assertion.
4. Final focused single-file runs with Bun **1.3.14**:
   - `bun test packages/auth/src/invitation-policy.test.ts`: **6 pass, 0 fail, 60 expect() calls** (160 ms).
   - `bun test apps/server/src/modules/identity/signup-preflight.test.ts`: **7 pass, 0 fail, 74 expect() calls** (364 ms).
5. Installed TypeScript **6.0.3** strict targeted no-write diagnostics passed (exit 0, no output), both initially and after final test changes:
   ```sh
   packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch packages/auth/src/invitation-policy.ts packages/auth/src/invitation-policy.test.ts apps/server/src/modules/identity/signup-preflight.ts apps/server/src/modules/identity/signup-preflight.test.ts
   ```
6. `git diff --check` passed; `git diff --cached --name-only` was empty. All five changed paths also receive explicit new-file whitespace checks because ordinary git diff excludes untracked files. LSP tools are unavailable in this worker; targeted installed diagnostics are not a full-project typecheck/build.
7. The import fixture launches fresh Bun with `--no-env-file`, only NODE_ENV=test, and throwing TCP/TLS/fetch/listen/timer guards. Both new production modules import successfully without runtime auth/DB/env/service composition. The pg-query fixture uses the dependency owner's real installed Drizzle builder and replaces only the client query protocol; no Pool or connection is instantiated.

Coverage/privacy limits:
- Policy tests cover absent/null context, wrong paths, missing verifier, malformed/missing/noncanonical tokens, mismatched or malformed account/body email, injected authority, verifier false/exception/nonboolean result, lowercase-only matching, and unchanged user/body with void success.
- Concrete-query tests inspect actual bound SQL/parameters and cover no bootstrap/inactive admin, unknown hash, wrong email/plus-tag mismatch, strict boundary/expired invitation, revoked/replayed/consumer-marked invitation, every existing-user binding, malformed input/authority fields, storage exception, repeat nonconsuming success, and denial after state changes. Offline hook+verifier composition returns no authority and rejects even a bound ID matching the proposed user.
- The offline client simulates rows/DB time/state; **it does not prove PostgreSQL predicates/constraints/clock evaluation, live DB readiness, lock/concurrency/atomic acceptance behavior or physical nonmutation**. The generated SQL is read-only; 004b remains the separate authenticated atomic consume/membership/audit path.
- **No actual installed-auth signup, endpoint JSON parsing, context propagation, user-write prevention, error response, session creation or existing signin/logout compatibility was exercised.** Source passthrough assertions are not real signup evidence. No schema activation/database/provider/production operation occurred.

Integration handoff (future approved 004d activation only):
- At trusted server composition, build `createInvitationSignupPreflight(database)` and supply it to `createInvitationSignupPolicy(...)`; inject the returned function as `databaseHooks.user.create.before` in createAuth configuration only after remaining gates. Do not create a fallback allow policy, change cookies/origins, add schema fields/plugins, use an after hook for consumption, or treat the callback as operator bootstrap provisioning.
- Ordinary new credential signup sends body-only invitationToken to the existing signup endpoint. Existing-user-bound invitations must use existing signin then authenticated 004b acceptance; a proposed new user ID is never proof of that identity. UI/client typed transport for the extra body field and generic repair messaging remain later integration work, not implemented here.
- Preflight is a snapshot. It grants no membership or role, consumes nothing and cannot reserve the invitation against revocation/expiry/acceptance races. Account/session creation without later accepted membership confers no domain authority. Authenticated acceptance must re-read/recheck and atomically consume/write membership/audit using 004b; domain gating is still required.
- Before production activation, independent review and separately approved disposable installed-auth/DB runtime checks must prove actual JSON/context/failure/user-write paths and preserve signin/logout/origin/cookie behavior. 004c retains PostgreSQL enforcement/concurrency proof; 004e retains operator bootstrap/recovery. Stop for concrete unsupported installed API/new behavior, not already-approved invitation policy.

Skipped by scope: installs/dependency/lockfile edits, migrations/schema/generators, DB/network/providers, actual signup/bootstrap/operator provisioning, production wiring/startup, builds/full suites/E2E, staging/commits/worktrees/deployment. Root RFC-004 and 004d remain incomplete. Independent source review and coordinator test confirmation are accepted; real installed-auth/database evidence is still required.

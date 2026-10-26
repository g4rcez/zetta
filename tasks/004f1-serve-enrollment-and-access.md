# RFC-004f1: Serve enrollment and current-member access

Parent: [004f](004f-connect-enrollment-status-and-login.md). Consumes accepted 004b, 004d1/d2/d3 and the [ownership policy](../docs/decisions/ownership.md); exports the server portion of [005](005-enforce-actor-and-resource-access-boundaries.md).

## Completion record

Status: review. The user authorized remaining v1 implementation, including identity route/auth wiring and local synthetic checks. Parent RFC-004f and RFC-005 remain incomplete until real auth/DB/browser enrollment and integrated resource checks pass. This slice adds no product resource endpoints or tables.

Changed paths: `apps/server/src/modules/identity/access.ts`, `access.test.ts`, `routes.ts`, `routes.test.ts`; `apps/server/src/app.ts`, `app.test.ts`, `services.ts`, `index.ts`; `packages/auth/src/index.ts` (coordinator-authorized type-only extension); this handoff. Existing dirty work preserved; no dependency/schema/operator/proof-script edits, installs, staging or commits.

### Consumer contract

- `GET /api/identity/status`: 200 `{state:"anonymous"}` or `{state:"unenrolled",userId}` or `{state:"active",userId,isAdmin}`. Only own ID and current membership/admin state. Removed and absent membership intentionally have the same unenrolled shape. Query IDs confer no authority. All responses have `Cache-Control: no-store`.
- `POST /api/identity/invitations`: strict `{intendedEmail,intendedUserId?}`; active sole admin; 201 `{invitationId,expiresAt,token}` with ISO expiry. Raw token returned once by the existing transactional issuance service.
- `POST /api/identity/invitations/accept`: strict `{token}`; authenticated identity (including removed/unenrolled); 200 `{userId}`. Existing service performs canonical-token/account checks and atomic claim/membership/audit.
- `POST /api/identity/invitations/revoke`: strict `{invitationId}`; active sole admin; 200 `{invitationId}`.
- Mutations require JSON, no query parameters, exact configured web/desktop Origin; absent/empty/null/untrusted origin denied. Optional Fetch Metadata rejects navigation/no-cors and unknown site values. Cross-site cors is permitted only with an explicitly trusted origin, preserving different-site web/API deployments. CORS alone grants no access.
- Errors: `{error:{code,message}}`; 400 `INVALID_REQUEST`, 401 `SIGN_IN_REQUIRED`, 403 `ACCESS_DENIED`/`UNTRUSTED_ORIGIN`, 404 `NOT_FOUND`, 409 `ENROLLMENT_UNAVAILABLE`, 503 `IDENTITY_UNAVAILABLE`. All identity responses/errors use no-store. Messages offer signin/retry/admin repair; no body/token/account-enumeration diagnostics.
- Strict Zod safeParse performs body parsing after origin/session checks. Elysia receives `t.Unknown()` intentionally: thrown framework body validation would enter the global logger. SafeParse errors never enter evlog; parser failures have a fixed response. Existing evlog receives no invitation body or service exception.

### Server integration and downstream rules

`createIdentityAccess(auth, lookup)` resolves only `auth.api.getSession({headers})`; `createMembershipLookup(db)` uses a fresh bound active-membership query and singleton admin pointer. `requireActive(headers)` returns a frozen `{userId,isAdmin}` registered in a private WeakSet. `sessionActor` is for acceptance only. Session/DB failures are opaque and fail closed. No cached member entitlement.

Future domain handlers must call `requireActive` on each request/dispatch, scope database lookups by `actor.userId`, and use `requireOwned`/`requireOwnedChild` for owner/nested references. These guards reject forged plain objects, missing resources, other owners and mismatched parents with the same NOT_FOUND error. Admin has no private-content bypass. Do not persist an actor as a session cache; long-running actions must resolve current access again. No claim of protecting future routes automatically.

Production `services.ts` now injects `createInvitationSignupPreflight(db)` into `createAuth` and composes the real access/enrollment services; `index.ts` injects identity into `createApp`. Factory imports remain infrastructure-free. Optional identity omission preserves the legacy fixture factory surface only; the production entry always injects it. Existing auth forwarding/cookies, trusted origins, health and CORS preflight behavior are unchanged and regression-tested.

### Verification and evidence

Evidence directory: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G001-preserve-all-existing-tracked-untrac/a1/identity-routes/`.

| Scenario | Exact invocation | Binary observable | Artifact |
| --- | --- | --- | --- |
| Existing app baseline | `bun test apps/server/src/app.test.ts` | 16 pass, 0 fail, 126 assertions before edits | `baseline.txt` |
| Current member resolution, anonymous/expired/removed denial, A/B/admin/forged/nested isolation, bound installed Drizzle read | Combined command below | 4 access tests pass, denial/immutability/query assertions hold | `tests.txt`, `access.test.ts` |
| Status/admin issuance/acceptance/replay/revoke, origins/authority fields, parser and token-log privacy | Combined command below | 5 route tests pass, expected HTTP statuses and no secret in captured evlog | `tests.txt`, `routes.test.ts` |
| Actual ephemeral loopback listener → fetch → close | Combined command below, test `actual loopback HTTP listener preserves fixture contract` | status 200, issue 201/no-store, accept 200, replay 409, nonadmin issue 403, revoke 200; listener closed in finally | `tests.txt` explicit HTTP receipt |
| Existing auth/cookie/CORS/health and secret-free import regression | Combined command below | 16 app tests pass | `tests.txt` |
| Strict changed-source diagnostics | Strict command below | exit 0 | `types.txt` |
| LSP identity module diagnostics | `mcp__lsp__diagnostics` filePath identity directory, severity error | 19 files scanned, 0 errors | `lsp.json` |

Final test command (Bun 1.3.14):

```sh
bun --no-env-file test apps/server/src/modules/identity/access.test.ts apps/server/src/modules/identity/routes.test.ts apps/server/src/app.test.ts
```

Result: 25 pass, 0 fail, 229 assertions. HTTP tests use synthetic session/membership/enrollment services and prove only actual transport/route composition, not real cookie authentication or transaction semantics. The first listener run failed on sandbox bind restriction; authorized elevated local-listener retry and full final suite passed. An initial fixture omitted session metadata needed by evlog; corrected fixture then reran the complete scenario. No production service was started.

The LSP tool reported zero identity-directory errors; a later artifact-edit hook reported the Biome server unavailable and installation previously declined. The installed TypeScript command is the authoritative strict compiler evidence; no Biome/lint success is claimed.

```sh
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/access.ts apps/server/src/modules/identity/access.test.ts apps/server/src/modules/identity/routes.ts apps/server/src/modules/identity/routes.test.ts apps/server/src/app.ts apps/server/src/app.test.ts apps/server/src/services.ts apps/server/src/index.ts
```

### Remaining gates

Coordinator requested a final type-only extension: `createAuthOptions` and `createAuth` accept `Omit<Database, "$client">`. The existing adapter does not consume the Pool-specific client property; this allows the reserved proof connection without an assertion. `bun --no-env-file test packages/auth/src/index.test.ts` passed 5 tests/49 assertions (`auth-types-tests.txt`). The strict command above was rerun with `packages/auth/src/index.ts packages/auth/src/index.test.ts` appended, exit 0. A compile-only `auth-database-types.ts` in the evidence directory constrains the actual `openIdentityProof` firstDb return type to the factory argument; `packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun <evidence-directory>/auth-database-types.ts` exits 0 (`auth-database-types.txt`). No runtime database/auth behavior changes in that extension.

Web worker can consume the status contract and keep token input on recoverable failure, then recheck status after acceptance. Coordinator must execute real disposable bootstrap → admin issue → B signup/signin/acceptance → replay/wrong token → signout/signin → removal denial with browser cookie transport. Existing service transaction evidence is a prerequisite, not newly rerun evidence. No build, live DB, real account, desktop protocol, or browser success claimed here. No unrelated future resource access or runtime isolation criterion is complete.

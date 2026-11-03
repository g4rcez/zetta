# 004d4: Prevent signup account enumeration

Status: implemented and verified on the disposable identity database. Integrated browser validation belongs to the parent v1 task.

## Reproduced defects

The installed Better Auth 1.7.7 signup endpoint checks existing accounts before the user-create database hook. Invalid invitations therefore returned different results for known and unknown emails. The expanded installed-handler proof failed before the fix (`red-runtime.log`, exit 1); its disposable Compose container/network cleanup passed.

A temporary account-table constraint also exposed non-transactional public signup: the no-orphan credential failure scenario failed (`rollback-red-runtime.log`, exit 1). Unexpected errors reached better-call 1.4.0 `dist/router.mjs:84-94`, whose fallback prints the driver error even when Better Auth logging is disabled. The captured synthetic diagnostic was removed from the retained receipt. No driver rows, passwords, hashes, or tokens are retained as evidence.

## Changes

- Explicit invitation-gated auth installs a supported `createAuthMiddleware` before hook. Missing, malformed, nonexistent, expired, revoked, consumed, and wrong-email invitations fail with the same bounded 400 body before account existence is consulted. Shared validation catches verifier failures and rejects authority fields.
- The existing database hook still validates the proposed user and rechecks invitation eligibility before creation. Authenticated acceptance still owns atomic consumption and membership activation.
- The public Drizzle adapter enables transactions. Credential failure rolls back the proposed user; the same invitation can retry.
- Gated auth uses supported `onAPIError.onError` to preserve existing API errors and translate unexpected errors to a fixed 500 response before better-call's diagnostic fallback. There is no production console override.
- The proof uses the configured desktop origin `views://mainview`; this verifies HTTP origin/session behavior, not a native desktop client.

## Verification

Evidence directory: `local evidence`.

| Scenario and invocation                                                                                | Binary observable                                                                             | Artifact                                                                     |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Before fix: `bash scripts/verify-identity-auth.sh auth`                                                | Exit 1 at expanded signup denial scenario; cleanup PASS                                       | `red-runtime.log`                                                            |
| Before transaction fix: same invocation with forced account constraint                                 | Exit 1 at credential no-orphan/retry scenario; cleanup PASS; raw synthetic diagnostic removed | `rollback-red-runtime.log`                                                   |
| Final: same invocation, fresh database                                                                 | Exit 0, seven PASS scenarios, cleanup PASS                                                    | `green-runtime.log`                                                          |
| `bun --no-env-file test packages/auth/src apps/server/src/modules/identity/signup.integration.test.ts` | Exit 0, 50 tests pass                                                                         | `unit.log`                                                                   |
| Strict TypeScript check of six touched source/test files                                               | Exit 0, no diagnostics                                                                        | `verification.md` (full invocation), `strict-ts.log` (empty compiler output) |
| Source LSP diagnostics for six touched source/test files                                               | No error diagnostics on each                                                                  | `lsp.json`                                                                   |

The final real-handler proof asserts known/unknown denial status and body equality; missing cookies; unchanged user/account/session/membership/consumption/audit counts; an identical denied trailing-slash alias; valid signup and credential persistence; revoked acceptance rejection and fresh acceptance; trusted web/desktop login and session invalidation; untrusted origin/CSRF rejection; and forced credential insert failure with zero observed console.error attempts, rollback, and successful retry. Test-only console observation is restored in `finally`.

No schema, web UI, shared launcher, or operator provisioning changes. No external provider calls or real credentials. No commit or staging.

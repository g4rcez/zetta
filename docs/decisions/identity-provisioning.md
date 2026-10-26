# Trusted operator credential provisioning

Decision: use the installed Better Auth 1.7.7 documented server API `auth.api.signUpEmail` in a dedicated composition that is never mounted as a public handler. This creates a new unentitled account. Existing bootstrap/replacement transactions remain separate; failed activation may leave an unentitled account requiring deliberate inspection. The user authorized continuing v1 implementation on 2026-10-22.

## Supported composition

Use existing auth schema and the relations-v2 Drizzle adapter with `transaction:true` (default is false). Enable email/password signup with `autoSignIn:false`; use `plugins:[]`, disabled library logging and telemetry, explicit validated config, no verification sender, custom hashing, synthetic-user callback or additional authority fields. Invocation contains only `{body:{name,email,password}}`: no headers, callback, role, invitation, verified flag or arbitrary fields. Better Auth owns password validation/hashing and credential linking. Construction follows operator input/target validation; imports stay inert.

The supported server API is documented in [email/password authentication](https://better-auth.com/docs/authentication/email-password). Version-specific behavior below was inspected directly in installed packages, 2026-10-22; current online documentation is not substituted for installed source.

## Resolved signup is not proof of creation

With automatic signin disabled, duplicate-email signup returns apparent success with a synthetic user ID and null token; some user-create-hook 403 failures use the same response. Verify all of the following before returning a trusted account ID:

1. Token is null.
2. A persisted user matches both returned ID and lowercased requested email.
3. Exactly one credential account matches that user's ID, provider `credential`, account ID equal to user ID and a nonempty password-presence boolean. Never retrieve the hash into a returned proof record.
4. No session exists for the new user.

Never substitute an existing email account's ID or call duplicate provisioning idempotent success. Return only the verified ID to trusted orchestration in memory. Output contains no email/password/hash/token/URL/raw auth response or exception. No automatic retry or deletion after an uncertain commit/readback/cleanup outcome.

## Installed primary-source evidence

Paths are relative to this repository:

| Source | Contract |
| --- | --- |
| `packages/auth/node_modules/better-auth/dist/api/routes/sign-up.d.mts:7` | Typed core signup endpoint and body/result types. |
| `packages/auth/node_modules/better-auth/dist/api/index.mjs:119` | Core server API includes signup. |
| `packages/auth/node_modules/better-auth/dist/api/routes/sign-up.mjs:144` | Signup uses runWithTransaction. |
| Same file, lines 145-204 | Password checks, normalized email, enumeration protection and synthetic duplicate success. |
| Same file, lines 214-240 | Library hashing, unverified user creation and credential linking; hook403 synthetic response. |
| Same file, lines 251-260 | autoSignIn:false returns before session creation/cookies. |
| `packages/auth/node_modules/@better-auth/drizzle-adapter/dist/relations-v2/index.d.mts:36` | Supported transaction option, default false. |
| Corresponding `index.mjs:536` | Enabled transaction wraps callback in db.transaction. |
| `packages/auth/node_modules/better-auth/dist/context/create-context.mjs:182` | Library password hashing/verification defaults. |

The independent librarian verified these installed contracts; no auth object, account, connection or runtime call was created during research. Upstream SHA retrieval was unavailable, so no fabricated SHA citation is supplied.

## Rejected alternatives and verification

`auth.api.createUser` belongs to the absent admin plugin and introduces role/session/schema work. InternalAdapter calls and direct credential inserts duplicate security-sensitive library orchestration. Public first-signup bootstrap violates the approved installation-operator boundary.

Focused tests must reject malformed/extra fields, synthetic duplicates, missing/mismatched persisted users, malformed/multiple credential readback, unexpected tokens/sessions, and opaque failure paths. A separate dedicated disposable proof must create through the real API, authenticate with the chosen password, reject incorrect passwords, reject duplicate/concurrent identity adoption, prove credential-link rollback, preserve unentitled accounts after failed activation, and preserve closed public signup. Effective cookie/cache revocation remains separate evidence, not an inference from deleted session rows.

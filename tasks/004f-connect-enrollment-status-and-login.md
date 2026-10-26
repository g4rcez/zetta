# RFC-004f: Connect enrollment status and login

- **Parent:** [RFC-004](004-implement-approved-enrollment-and-admin-bootstrap.md).
- **Prerequisites:** integrated [004b](004b-implement-transactional-enrollment.md), [004c](004c-verify-identity-database-constraints.md), [004d](004d-gate-auth-signup-with-invitations.md), [004e](004e-bootstrap-and-recover-installation-admin.md).
- **Status:** parent row in [TASKS.md](../TASKS.md) is authoritative.

## Goal

Connect the approved enrollment policy to server-owned identity status and existing login UI, so users can test the real bootstrap/invitation/signin path.

## Non-goals

No public bootstrap, custom auth provider, unrelated dashboard redesign, complete future-resource ACL implementation or new dependency. The full bot layout belongs to RFC-024.

## Contract and bounded paths

Split into server and web writer assignments if needed, never concurrent writers in this cwd. Server: identity routes/tests and app/service wiring. Web: existing login/signup/authenticated-layout components and a minimal typed identity client.

Approved route proposal: GET `/api/identity/status` returns only the session owner's anonymous/unenrolled/active state; POST `/api/identity/invitations` issues once for the active sole admin, POST `/api/identity/invitations/accept` consumes a token using server-derived identity, and POST `/api/identity/invitations/revoke` is admin-only. No role/owner body authority, no account enumeration or token URLs/logging. Use trusted-origin/CSRF checks for cookie mutations; CORS is not authorization. Authenticated unenrolled accounts can accept/check own status/logout, never access domain resources.

Default login to signin; require invitation for signup; route account creation to acceptance/status, not assumed membership. Unenrolled UI offers paste token/retry/signout and contact operator, not a bootstrap button. Keep user state across recoverable acceptance failure. Export immutable server-derived active-member context for RFC-005; record ownership of pre-handler integration to avoid a dependency cycle with that RFC. Future resources still need their own owner/nested-reference checks.

## Acceptance criteria

- [x] Actual disposable CLI/HTTP/browser journey covers bootstrap, admin issue, B signup/signin/acceptance, invalid/replay denial, signout/signin and removal/repair.
- [x] Server-derived active-member and owner/nested-reference contracts deny anonymous/unenrolled/removed/foreign/private access. Future domain query consumers remain responsible for actual scoped lookups.
- [x] Actual web and desktop-origin HTTP/session/cookie regressions pass, token/diagnostic privacy is enforced, and browser failures expose bounded repair paths.

## Verification

Focused route/client tests; approved disposable auth/DB and browser checks separately. Record the exact user test steps and expected states. A fake-session endpoint test alone cannot finish the parent RFC.

## Definition of done and handoff

Parent RFC-004 criteria are reviewed across all child evidence; only then may its root row become Done and RFC-005 consume the active-member contract. Unsupported real environment remains an explicit blocker.

## Completion record

Integrated scope accepted after [independent final WATCH/APPROVE review](../docs/verification/reviews/identity-final-review.md) with no blocker. [004f1](004f1-serve-enrollment-and-access.md) exports real status/invitation routes and immutable server-derived actors; [004f2](004f2-connect-enrollment-web.md) connects signin/signup/repair and one-time invitation management. [004f3](004f3-prepare-disposable-identity-browser-qa.md) provides the opt-in actual auth/DB browser fixture; [004f4](004f4-verify-identity-web.md) and [004f5](004f5-bound-authentication-requests.md) correct observed responsive/theme and request-recovery defects. [Coordinator browser evidence](../docs/verification/identity-browser/walkthrough.md) records the actual connected journey, final source corrections and owned cleanup. Server telemetry no longer prints session causes and reflects actual denied statuses; unexpected public auth errors are bounded by004d4. Actual configured desktop-origin HTTP compatibility passed; no standalone desktop UI is claimed. Core ownership helpers are accepted as contracts, not a blanket proof of future resource-query consumers.

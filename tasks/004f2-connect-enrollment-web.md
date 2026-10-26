# RFC-004f2: Web enrollment and login journey

Parent: [RFC-004f](004f-connect-enrollment-status-and-login.md). Root `TASKS.md` remains the authoritative status index.

## Scope and approvals

The coordinator assigned the existing login, signup, authenticated layout, dashboard and a small web-owned identity client. The user authorized the remaining v1 implementation, local focused checks/builds and disposable browser QA. No dependencies, shared UI, server/auth/database files, generated files, environment secrets, staging or commits were changed by this worker.

Inputs: [execution contract](README.md), [plan](plan.md), [intent](../docs/intent/zetta-v1.md), [ownership](../docs/decisions/ownership.md), and the fixed server contract supplied by the server owner. Shared `@zetta/ui` Button/Input/Label controls, React 19, TanStack Router/Form and installed Zod are reused. The frontend UI engineering skill informed the state and accessibility review.

## UI Review Checklist — completed before implementation

### 🔄 Loading States

- ✅ Initial identity verification gates login/protected content and announces status. Forms disable controls and announce submission; enrollment and revocation have pending text.
- ✅ Responsive containers reserve the page structure while requests run; network requests and response-body parsing time out after 20 seconds and expose recovery rather than waiting indefinitely.

### 🪹 Empty States

- ✅ Authenticated users without membership see invitation entry, operator guidance, check-status and signout actions. Anonymous users begin at signin.
- ✅ Admins begin with the issue form. There is no invitation-history API or invented list. Lack of membership is explained separately from lack of invitations.

### 💥 Error States

- ⚠️ Existing forms assumed authenticated accounts could navigate to the dashboard and surfaced only toasts. Resolved with identity checks, persistent inline errors and repair actions.
- ✅ Network/malformed response/permission/origin/session/expired-or-invalid invitation errors use safe client messages; response messages are never reflected, avoiding token echoes.
- ✅ Field validation is associated with inputs. Acceptance failure preserves the token. Unknown invitation-issue outcomes warn against blindly issuing another invitation.
- ✅ Failed signup status checks offer retry/signout. If signup succeeds without a confirmed session, signin is offered and the invitation remains available for later acceptance.
- ✅ There is no resource-detail page needing a distinct 404 in this slice; unexpected server status/shape fails closed with status recovery.

### ⚡ Optimistic UI

- ✅ Membership, signup, issue and revoke wait for server confirmation. No client-side optimistic authorization or automatic mutation retry.
- ✅ TanStack submission state plus mutation guards prevent duplicate actions. Successful acceptance clears the token and checks actual membership before navigation.
- ✅ Invitation results display expiry and support copy, hide, revoke and finish. Hiding clears the token from component state while preserving only the displayed ID for revocation.

### 📄 Pagination / Infinite Scroll Edge Cases

- ✅ Not applicable. There is no invitation list/history API. Only the invitation issued in this screen is available for revoke; this limit is explained visibly.

### 🔐 Auth-Gated / Permission-Based Visibility

- ⚠️ The existing route guard checked only the session. Resolved with server-derived active membership before loading the dashboard.
- ✅ Only server-confirmed active admins see issue/revoke controls. Backend authorization remains mandatory; a client flag cannot grant authority.
- ✅ Anonymous/unenrolled users return to `/login`. Identity-service failure hides protected content and offers retry/signin recovery. Removed users cannot re-enter protected routes based on an old session alone.

### Accessibility spot-check

- ✅ Shared native labeled controls and text buttons are keyboard reachable. Field errors use `aria-invalid`, `aria-describedby`, and alerts; dynamic feedback uses status regions.
- ✅ Login, signup and enrollment headings receive focus after transitions. The one-time result receives focus when issued; hide/revoke/finish return focus to surviving controls/headings.
- ✅ Status and error meanings are written as text, alongside semantic colors. No modal/focus trap or new animation is introduced. No icon-only action exists in this slice.
- ❓ Actual keyboard, screen-reader, contrast and 320px layout behavior still require the coordinator's real browser check; source inspection is not browser evidence.

### Micro-interaction audit

- ✅ Pending labels, disabled controls, copy success/fallback feedback, explicit token hiding and wrapped action rows are implemented. Tokens never enter toasts, URLs, browser storage or logs.
- ✅ No item insertion/removal animation or notification overlay is needed. Existing shared focus/hover styles are retained.

### Architecture

- ✅ `LoginJourney` owns only ephemeral identity/token/error state; form components own form validation and submission. `EnrollmentForm` presents repair controls; `InvitationManager` owns the bounded issued result.
- ✅ The typed client performs runtime response parsing and receives an injected fetch in tests. No global fetch mock, unsafe cast, auth schema/plugin or new dependency was introduced.

### Summary

- ⚠️ 0 unresolved product decisions; the 2 pre-existing missing behaviors are implemented.
- ❓ 1 verification boundary remains: integrated browser validation.
- ✅ All six mandatory state sections are covered; pagination and resource-detail 404 are explicitly inapplicable.

## Exported contract and connected next action

- `lib/identity-client.ts`: cookie-bearing, no-store `/api/identity/status`, issue, accept and revoke calls; direct `/api/auth/sign-up/email` request preserves `invitationToken` without bypassing Better Auth typing or inventing user schema fields. The installed public session-hook refetch refreshes the Better Auth session atom after raw signup before membership verification/navigation. Zod parses response boundaries; no server error message is echoed.
- `/login`: signin by default; invitation-required signup; actual status plus acceptance; authenticated unenrolled repair with paste/retry/signout. Acceptance drafts survive recoverable errors and clear after success/signout.
- `/_auth`: actual active identity guard plus existing session context for greeting; errors provide retry and signin.
- `/dashboard`: existing greeting plus admin-only bounded invitation creation/result/revocation.
- Account creation does not manufacture membership. The next action is acceptance/status verification; only active users continue to the dashboard. Future domain APIs must enforce membership/ownership independently.

## Completion record

Status: ready for coordinator integration review and real disposable browser QA. This handoff does not mark parent RFC-004f complete.

Changed paths:

- `apps/web/src/routes/login.tsx`
- `apps/web/src/routes/_auth/route.tsx`
- `apps/web/src/routes/_auth/dashboard.tsx`
- `apps/web/src/components/sign-in-form.tsx`
- `apps/web/src/components/sign-up-form.tsx`
- `apps/web/src/features/identity/auth-field.tsx`
- `apps/web/src/features/identity/enrollment-form.tsx`
- `apps/web/src/features/identity/login-journey.tsx`
- `apps/web/src/features/identity/invitation-manager.tsx`
- `apps/web/src/lib/identity-client.ts`
- `apps/web/src/lib/identity-client.test.ts`
- This handoff.

Verification:

- `bun test apps/web/src/lib/identity-client.test.ts`: 11 pass, 0 fail, 30 assertions. Covers anonymous/unenrolled/active parsing, fail-closed malformed authority, cookie/no-store origin requests, token only in POST body, issue expiry/account binding, revoke ID, invitation-preserving signup, safe errors, no automatic network retry, aborted stalled fetch and aborted stalled JSON parsing.
- `NODE_ENV=production VITE_SERVER_URL=http://localhost:3000 bun run --cwd apps/web build`: passed. The authorized build generated the previously absent ignored `routeTree.gen.ts`; no generated file was edited by hand.
- `bunx --no-install tsc --noEmit -p apps/web/tsconfig.json`: passed after route generation and a test-local Bun type reference.
- Focused `oxfmt --write` restricted to the assigned source files: passed. Root formatting commands were not used.
- `bunx --no-install oxlint` restricted to the assigned source files/directories: exit 0, no diagnostics.
- LSP diagnostics on `apps/web/src`, severity error: 17 TSX files scanned, 0 files/errors. The strict TypeScript command above covers TS files as well.
- No app/server/database fixture is represented as browser proof. This worker did not run real backend browser QA, install dependencies, read environment secrets, start persistent resources, or modify root `TASKS.md`.

## Coordinator browser walkthrough

Use the authorized disposable backend/database and existing real browser setup. Do not retain real tokens in screenshots, URLs, logs or test artifacts.

1. Anonymous `/login` shows Welcome back. Switch to Create account; email/name/password/invitation are required. Try invalid invitation; see inline error, remain outside dashboard.
2. Sign in as the bootstrapped admin. `/dashboard` shows Invite a member. Enter B's intended email (optional exact existing account ID), create once, verify visible expiry, copy feedback and disabled in-flight controls. Keep the synthetic issued token transiently for B.
3. Hide token: it disappears permanently from this result; revoke remains available by the displayed invitation ID. Revocation confirms completion. A new page load exposes no token or fabricated invitation history.
4. Issue a fresh invitation and use B's matching email to create an account. Account creation proceeds through actual status/acceptance; only confirmed active membership navigates to dashboard. B sees no admin invitation controls.
5. Sign out/in as B; active membership returns to dashboard. Replay or wrong-account token attempts deny without dashboard access.
6. Sign in to an authenticated unenrolled account. `/login` shows Join this installation; paste invalid token, submit, verify the draft stays and retry/status/signout remain usable. Accept a valid invitation and confirm navigation only after active status.
7. Remove B through the approved operator procedure. Navigate/reload `/dashboard`: protected content is denied and the login repair/signin path appears according to actual server session state.
8. Exercise API unavailability for status: loading is announced, errors are visible, retry works, and protected content remains hidden. For a lost issuance response, do not blindly issue another invitation.
9. At 320px, 768px and desktop widths check overflow, input/button labels and wrapped result controls. Tab through forms/actions; verify focus after signup/enrollment/result changes, field error associations, visible focus and pending status announcements.

Remaining limits: clipboard writing depends on the browser's secure-context permission; manual selection/copy is the fallback. Existing header/user-menu behavior remains owned by its current implementation. No real browser, real database membership, clipboard permission or server authorization claim is made by these client fixtures.

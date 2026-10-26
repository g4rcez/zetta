# RFC-004f5: Bound authentication requests

Parent: [004f](004f-connect-enrollment-status-and-login.md). Status: review; source and native-client composition verified, coordinator live browser recheck pending. Addresses independent final review M1 under the user's v1 continuation authorization.

## UI review and scope

Loading: existing signin/session pending state must settle on a deadline; header signout now disables duplicate submission and displays its pending state. Empty: existing anonymous/session UI remains unchanged. Errors: retain fixed connection repair messages; header signout reports an actionable toast instead of leaving an unhandled rejection. Optimistic: no success, navigation or session update is asserted before actual success; uncertain mutations are never automatically retried. Pagination: not applicable. Auth visibility: membership/access still comes from the server; a failed request grants no access.

Existing shared buttons/menu/toaster retain labels, focus and keyboard behavior. No new animation, modal or product decision was introduced. No DB, API, account, dependency or schema change is part of this slice.

## Reproduction before correction

Installed Better Auth 1.7.7 uses `@better-fetch/fetch` 1.3.2. Its `getTimeout` skips its timer when a caller supplies a signal, as the native session atom does. Its main fetch clears the timer as soon as response headers arrive, before reading `response.text()`.

The worker reproduced both cases through the actual installed `createAuthClient`, with synthetic injected fetches and no network. Configuration was `timeout: 5, retry: 0`; an outer 30ms observation bound only measured whether the native call settled. Observed fixed receipts:

```json
{"phase":"headers-with-session-signal","outcome":"still-pending","signalAborted":false}
{"phase":"body-after-headers","outcome":"still-pending","signalAborted":false}
{"phase":"native-stream-body-after-headers","outcome":"still-pending","signalAborted":false}
```

The first operation called the installed session atom's `refetch()`. The second called actual `signIn.email` against a Response whose `text()` never resolves. The additional native-stream control used an ordinary Response with an unclosed ReadableStream containing a partial JSON byte; it reproduced the same pending body behavior without overriding Response methods. No credential values or native account state were read or logged.

## Contract and change

- `apps/web/src/lib/auth-transport.ts` exports `createAuthenticationFetch` and a fixed-message `AuthenticationRequestError` with timeout/cancelled/unavailable/response-too-large codes. Default deadline is 20 seconds for the complete headers-plus-body read, including native session requests that have an existing signal.
- The transport forwards all request options, combines caller cancellation with its own controller, and drains a clone under a 1 MiB response limit. It returns the **original Response**, with native status, headers, URL/redirect metadata, cookie behavior and unread buffered body intact. Better Auth retains parsing, response hooks, refresh, atom updates and action semantics.
- Deadline/caller abort rejects even if an injected fetch ignores the signal. Failure aborts the transport, cancels both body branches, and removes timer/listener state. A response arriving after the deadline is cancelled. Library/network causes never enter the returned message or logs.
- `auth-client.ts` installs this transport via the supported `fetchOptions.customFetchImpl` and explicitly selects `retry: 0`. This covers signin, get-session, session refetch/refresh and signout without replacing the native session hook. Existing raw invitation signup already has its independent full-body deadline in `identity-client.ts`.
- `user-menu.tsx` now awaits signout, guards duplicate clicks, restores its action on failure and displays a fixed repair toast. It navigates only after actual success. The existing login journey already has bounded-action recovery UI.

The deadline is per HTTP request. A native GET followed by its documented refresh POST remains two individually bounded requests. This change does not disable the library's ordinary future session refresh lifecycle or retry an uncertain mutation.

## Verification

```sh
bun --no-env-file test apps/web/src/lib/auth-transport.test.ts apps/web/src/lib/identity-client.test.ts
bun --no-env-file apps/web/node_modules/typescript/bin/tsc --noEmit --project apps/web/tsconfig.json
bun --no-env-file apps/web/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext,dom --types bun --jsx react-jsx --esModuleInterop --verbatimModuleSyntax --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/web/src/lib/auth-transport.ts apps/web/src/lib/auth-transport.test.ts
bunx --no-install oxlint apps/web/src/lib/auth-transport.ts apps/web/src/lib/auth-transport.test.ts apps/web/src/lib/auth-client.ts apps/web/src/components/user-menu.tsx
# workdir apps/web
bun --no-env-file run build
```

Final focused tests: 23 pass, 0 fail, 85 assertions across two files (12 new transport/composition cases). Tests use a manually triggered deadline rather than sleeps. They cover hanging headers/body, cancellation and pre-abort, exact original Response/request preservation, readable HTTP denial, oversize abort, safe network/body errors, late-response cleanup, actual Better Auth successful signin hooks/cookies, native session-refetch loading settlement, and uncertain signout with no retry or success hook.

Web project TypeScript, targeted strict diagnostics (including exact optional properties), focused lint and production build all exited 0. Build transformed 2531 modules. Changed product source LSP diagnostics: none. The first strict pass caught nullable native atom lookup in a test; the test now explicitly checks the installed atom exists, without casts or suppression. The optional no-excuse audit remains unavailable under the previously documented TypeScript 6 versus TypeScript 7 API mismatch; it is not claimed as passed.

No server, container, account or browser was started by this worker. Required coordinator follow-up: actual signin/signup/session confirmation/signout with this final transport, plus visible recovery for an interrupted authentication request where feasible. Existing browser results preceding this correction are not silently treated as evidence for its final source.

## Handoff

Only the new transport/test, existing auth client/menu, and this record were changed. No credentials, raw errors, invitation tokens, auth configuration selectors or fallback global account state were introduced. Parent RFC-004/005 acceptance remains coordinator-owned; this source slice does not claim v1 completion.

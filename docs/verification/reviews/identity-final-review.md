# Final identity review — correction delta approved with followups

2026-10-22, subsequent review. This current decision supersedes the historical BLOCK decision retained below.

- codeQualityStatus: WATCH
- recommendation: APPROVE
- blockers: none in this reviewed correction delta.
- reportPath: local evidence
- Final browser condition resolved: inspected the coordinator's durable correction-delta receipt in docs/verification/identity-browser/walkthrough.md. This approval does not mark v1 or unrelated resource/native integration goals complete.

## Current severity and resolution

**CRITICAL:** none. **HIGH:** none remain.

**H1 resolved.** The supported before-endpoint hook now rejects invalid invitation requests before installed Better Auth performs account lookup, while the user-create hook rechecks the policy. Inspected actual installed dispatch ordering and the seven-case runtime log. Known/unknown emails receive equal status/body and no cookies/writes for missing, malformed, nonexistent, wrong-email, expired, revoked and consumed tokens. The proof also compares trailing-slash behavior without assuming it is a valid alias. Valid signup, real acceptance and trusted web plus views://mainview signin/session/logout remain covered. This is an actual handler/DB proof, not a claim that a native desktop shell was launched.

The additional credential-insert failure is corrected by real adapter transaction:true. The forced account constraint proves user/account/session row counts remain unchanged and the invitation can be retried. onAPIError maps unexpected errors to a fixed APIError; installed better-call catches this before raw console fallback. The proof's sticky console-error attempt flag confirms no raw fallback attempt in this forced failure. Existing APIErrors retain their supported response behavior; no new exception swallowing or auth bypass was found.

**M1 resolved in source, native-client tests and coordinator browser evidence.** The supported customFetchImpl uses a per-request 20-second deadline covering headers and clone-body completion, a 1 MiB cap, original Response return, no mutation retries and caller cancellation. Failed or late responses cancel owned bodies, deadline/listener cleanup occurs on all completion paths, and losing promises remain handled by Promise.race. Native session-refetch tests prove pending flags clear, and uncertain signout cannot run success hooks or replay. Header signout now catches errors, reports a fixed message and releases its duplicate-action guard. The final browser receipt now confirms actual stalled-body recovery after 20125ms, fixed visible toast, restored manual retry, zero console warnings/errors and exactly one signout request. This was an explicit owned loopback network-fault fixture, not a real auth/DB fault.

**MEDIUM M2 remains nonblocking:** handwritten Drizzle typing and SQL-layout assertions at access.test.ts:47–63. The same test-maintenance concern applies to packages/auth/src/index.test.ts:157, which pins source adjacency/whitespace for provider/transaction/schema rather than behavior. Its recent failure after adding transaction:true illustrates brittleness. Existing actual rollback proof provides the relevant behavior evidence. Replace these pins with typed/behavioral assertions in a followup. No demonstrated runtime defect remains from them.

**LOW:** no new finding.

## Correction validation and skill review

Independently executed:
`bun --no-env-file test packages/auth/src/index.test.ts packages/auth/src/invitation-policy.test.ts apps/web/src/lib/auth-transport.test.ts apps/web/src/lib/identity-client.test.ts`
Result: 36 pass, 0 fail, 209 assertions, exit0.

Inspected actual `a1/signup-privacy/green-runtime.log`: seven scenario PASS records, row-count preservation true, final proof PASS and exact container/network cleanup. Its `verification.md` records worker launcher exit0 and failed-first receipts. Parent additionally reports independent auth session98115 passed all seven; this reviewer did not launch DB/server processes. Inspected task004f5 source contract, actual transport tests, updated signup integration assertions and installed Better Auth/better-call dispatch/error implementation. No source edit or runtime interference by reviewer.

Previously loaded programming and remove-ai-slops perspectives were applied again. Behavioral cancellation/rollback/privacy tests are relevant and not tautologies. Bounded clone drainage is justified by installed fetch clearing its own deadline at headers and skipping it for caller signals; preserving original Response avoids metadata/cookie replacement. No needless new parsing/abstraction found. The remaining source-format/SQL pins are the explicit skill-perspective violation.

## Final browser receipt integration

Receipt-only followup; no production source changed or additional code review pass performed. Read the final section of docs/verification/identity-browser/walkthrough.md and confirmed both referenced screenshot files exist. Coordinator fixture75714/web75376 passed admin signin, invitation issue, logout, invited signup, raw-signup session refresh, atomic acceptance to member Dashboard, member logout/signin. Artifact: docs/verification/identity-browser/final-transactional-signup.png. Fixture/Compose cleanup exited0.

The actual browser's stalled response body signout recovered with the fixed toast after20125ms, enabled manual retry, issued exactly one request and produced zero warning/error records. Artifact: docs/verification/identity-browser/auth-stalled-body-recovered.png. The first toast observation was inconclusive; the second condition-wait captured it. Owned fault server36423 exited0; web75376 stopped130; temporary tab closed; coordinator lsof showed ports3001/3002 clear. These are coordinator-observed receipts, not an independent browser run by this reviewer. They resolve the previously pending browser condition. WATCH/APPROVE remains solely for the nonblocking M2 test-maintenance findings; blockers remain empty.

## Corrected source SHA256

```text
24f62096008c6e31a6037463e2bda3de3d1a3ecca870b1cfbd82286954d2a62c packages/auth/src/index.ts
1ef22792a2b983abf830d48517a85a7d84a6de6c666e174dd2d7169ed89ad8a8 packages/auth/src/index.test.ts
f832a04c4459f7cea33035fb3bdd73dcfa412d38ce088f5044590a7f4a531a2b packages/auth/src/invitation-policy.ts
c25edf6b3c81a8b87b581d9b242f0badca92bdbd8d9d42ae9134213f5a1ecbc9 packages/auth/src/invitation-policy.test.ts
3b655eec3a83fd7a68ab6ee1633f396e796b5b37cbd6d72fcd036657f9d04a02 apps/server/src/modules/identity/signup.integration.ts
a9be510adc537a67069fdc5993939314e8677b3501c65cc6bee6343b44080f26 apps/web/src/lib/auth-client.ts
c856674e1ae53d996928da5b48f5f3570fe085fe890864cc35bbddb9d608524a apps/web/src/lib/auth-transport.ts
59144c9ab7a2e46658ab2d0a40d4f8c06bffe9d0c075af94d2b5d551477eb827 apps/web/src/lib/auth-transport.test.ts
0ab38cd122cddca3e014880887f55496b3ae0c60b85962852286d8a9c122f780 apps/web/src/components/user-menu.tsx
```

---

# Historical review — superseded findings retained

# Final identity review — changes requested

2026-10-22. Read-only source review; no code, database, server, Git or launcher mutation by this reviewer.

- codeQualityStatus: BLOCK
- recommendation: REQUEST_CHANGES
- blockers: H1 public signup discloses existing accounts before invitation validation.
- Scope: server access/routes/app/services; auth invitation policy and operator provisioning; credential operator command/CLI/proof; web identity client, signin/signup/enrollment/invitation flows, protected route, header/account menu/theme.
- Goal: closed invitation enrollment, current membership/admin authority, opaque failures, bounded/recoverable identity journeys and real credential operator proof. Existing ownership/checkpoint/task documents supplied notepad context; no separate notepad path was provided. Most new source is untracked, so this is a complete current-source review rather than a clean isolated historical diff.

## CRITICAL

None found.

## HIGH

**H1 — Existing-email signup bypasses invitation policy and exposes account existence.** `packages/auth/src/index.ts:34` retains default auto-signin; invitation admission is installed only at `index.ts:45–51` / `invitation-policy.ts:27–38` as user.create.before. Installed Better Auth 1.7.7 `dist/api/routes/sign-up.mjs:155,192–204` looks up the normalized email first and returns 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL for existing accounts. Unknown addresses proceed to the hook and receive 400 FAILED_TO_CREATE_USER for the same invalid invitation. This leaks whether an account exists to an unauthenticated caller, despite the web client replacing visible errors with generic text.

Coordinator independently confirmed this through actual disposable browser-fixture session82328: identical invalid invitation/password, known seeded email ->422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL; unknown email ->400 FAILED_TO_CREATE_USER. The reviewer independently inspected the installed branch and production wiring, but did not run the database reproduction. Root must retain its raw sanitized receipt as the runtime artifact; this report records the coordinator message, not an invented independent runtime test.

Require uniform denial before account lookup for missing/invalid invitation, or another design that demonstrably prevents this distinction while preserving valid signup and existing-account repair. Merely setting autoSignIn:false is insufficient: synthetic existing-account success could still differ from unknown-account denial. Add a real HTTP regression comparing known and unknown addresses under the same invalid/missing token, and verify no rows/sessions/membership change. Current signup integration tests exercise invalid tokens only against new email addresses.

## MEDIUM

**M1 — Better Auth client calls can leave identity UI pending indefinitely.** `apps/web/src/routes/_auth/route.tsx:18` awaits getSession after the bounded identity status call; `apps/web/src/lib/auth-client.ts` supplies no timeout. Signin and session refresh/signout in the login journey use this same unbounded client. Installed better-fetch only schedules cancellation when its timeout option is supplied. A response which never completes leaves the protected route's Checking your membership state, or a disabled login action, without reaching its retry error. Source-supported finding; stalled transport was not independently exercised in this review. Configure a finite whole-request deadline and behaviorally verify loading releases and retry succeeds. This is a recovery/availability issue, not demonstrated access bypass.

**M2 — Existing test bypasses installed typing and pins incidental SQL layout.** `apps/server/src/modules/identity/access.test.ts:47–49` casts a dynamic Drizzle import to a handwritten shape; `:60–63` pins fragments and parameter order. This remains the earlier nonblocking review item. Use actual installed types or a typed seam and semantic binding assertions; no demonstrated runtime access failure. Both skill perspectives flag this maintenance burden.

## LOW

No additional release-blocking finding. Native/desktop-origin runtime and cookie-cache-enabled behavior remain explicit proof limits, not inferred successes.

## Verified fixes and supported conclusions

The prior identity review's raw session-error logging and incorrect observed HTTP status are fixed in current app composition; regression tests cover sanitized error behavior and response status capture. Original auth remains available to the actual access boundary. Production services explicitly inject invitation preflight/access/enrollment.

Active membership and sole-admin status are resolved from database state; opaque identity responses and no-store remain. Mutation Origin/body admission and server-side admin authority remain enforced. Owner/child helpers validate issued actors and ownership, but absent future resource consumers are not proven protected.

Operator provisioning uses the actual installed auth primitive with transaction support, no automatic session and persisted returned-ID/credential readback. That readback is necessary for installed synthetic duplicate success and is not needless parsing. Credential CLI guards target/telemetry/input before opening, bounds the lifecycle and keeps failures opaque. Actual proof exercises stale-admin and audit-failure unentitled orphans explicitly rather than claiming cross-phase atomicity. Final proof receipt contains six PASS checks, exact owned cleanup, launcher exit0.

Web token handling is transient memory/body only, admin visibility follows server identity, enrollment repair exists, and pending actions use explicit guards. Reviewed latest browser record preserves original mobile overflow/launcher failure and records corrected responsive/menu/theme/lifecycle results. Real browser observations were coordinator-executed, not independently driven by this reviewer.

## Independent validation and inspected evidence

Executed by this reviewer:

`bun --no-env-file test packages/auth/src/operator-provisioning.test.ts apps/server/src/modules/identity/credential-operator.test.ts apps/server/src/modules/identity/access.test.ts apps/server/src/app.test.ts apps/web/src/lib/identity-client.test.ts`

78 pass, 0 fail, 380 assertions across five files; exit0. This is offline test evidence, not a live DB or browser run.

Inspected:

- `docs/verification/reviews/identity-access-provisioning-review.md`
- `docs/verification/reviews/004e3-review.md` and accepted sticky-guard correction
- `docs/verification/identity-browser/walkthrough.md` including final 320/768/1280 widths and fixture exit0
- `a1/coordinator-identity-receipt.md`
- `a1/credential-cli-proof-evidence.md` and actual `a1/credential-cli-proof-runtime.log` (six checks, cleanup, exit0).

The browser receipt identifies `admin-menu-fixed-320.png` and `admin-fixed-desktop.png`; this reviewer has not independently rerun visual behavior or clipboard reading. No comprehensive accessibility audit, native integration proof, production rollout or v1 completion is claimed.

## Skill perspectives

Explicitly consulted installed `omo:remove-ai-slops` and `omo:programming` SKILL.md. Overfit/slop review ran over production and tests. No new deletion-only, tautological, prompt-text or constant-mirroring tests were found in the reviewed behavioral changes. M2 violates the typing/test-maintainability perspectives. Boundary schemas, credential readback and proof target/cleanup guards serve concrete requirements; no unnecessary production extraction/normalization layer was found. M1 conflicts with bounded async/recoverable state guidance.

## Source SHA256 at review

```text
1a9bbe116a38d019796a86b9c2e0ab2d88e36677bd723ce60d775b4b420ff60a apps/server/src/app.ts
1f417b821623f2dfd353f357bfc6a066fe896ec410b0abf94f42d1253ed8332f apps/server/src/services.ts
0bbebd5d68bc6edae39491bd8cf952bc9762b57b22d1d3f57d15d7f65d018e40 apps/server/src/modules/identity/access.ts
f59b0719b4ee91a782a623ec59e14cf2a4e640d8f2b3707640b3fbaee26879e7 apps/server/src/modules/identity/routes.ts
95703acdde45fe54553325b32aa27432bba18b274a54a667b0a11441733ce6c7 apps/server/src/modules/identity/credential-operator.ts
41794f346f895478f10fbf2fa9d94caa39afd15bee00d15a1869d0a20119bd0c apps/server/src/modules/identity/credential-operator-cli.ts
fa73e27dcafe92dbe86d9ba3e04b2c97c7b04fa34bfb2fa66b5621eae3ac74c0 apps/server/src/modules/identity/credential-operator.integration.ts
8a2ec6e2f0215a0717653a90dbbaa3090dbc78969f096c2b93f2ecd857c77b24 packages/auth/src/index.ts
a017b033ce5addc883e3e8389d95d1b029868d24e25cff5d697bffcb8d906293 packages/auth/src/invitation-policy.ts
24c0b60abdbd098716c04ef2063f8e25f3944cd7091229f08bbf60574ff309f7 packages/auth/src/operator-provisioning.ts
f7386501abbbefd5f5dde4dd4ca2aab663d14c8094fd399c5ceea64eeede93af apps/web/src/lib/identity-client.ts
b22dcfec2ca1decb0793b738151f87cc340085bf2c491088521e493adc855ea7 apps/web/src/features/identity/login-journey.tsx
edf15d4ef9f32571c75abb675f89d28d55d7b25507978d6d6d86f4a53228dee7 apps/web/src/features/identity/enrollment-form.tsx
be1b793ce5c23449a3946fcfa5ab2e66eae6d24fc57b9d2471df32b4583132d2 apps/web/src/features/identity/invitation-manager.tsx
0edaf5d1b953cc04bf725195a80b295c9fc606cf62de5b8822ab8316b8fa4a66 apps/web/src/components/sign-in-form.tsx
1d9794a245800441cbae0a1f04aa20c12ce146bace23cfcc0ac88190b6fe815d apps/web/src/components/sign-up-form.tsx
1e71d53178703aaf7b5c7f7cdb7e4e629b59046293aa7782912af22951a2aaa9 apps/web/src/routes/_auth/route.tsx
db6e3e56b6b0c9480d3f82e65b0a2307b4116b5029f077642ea17ef070383823 apps/web/src/lib/auth-client.ts
300fadb71f0048237308cce2d06d15b16edbe45a2ade17df788cb6dbe4b84d5f apps/web/src/components/header.tsx
e1b411902aeba8cbb11e2919bf804862c577bd92e7a22dbde62cba1824e9deaf apps/web/src/components/user-menu.tsx
fa510319d7045b30e50a8525f0915848001c8ae59075c9d38eadd20d3ef12d8d apps/web/src/components/theme-provider.tsx
```

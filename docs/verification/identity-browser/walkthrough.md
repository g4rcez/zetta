# Identity browser walkthrough

Coordinator-observed on 2026-10-22 through the actual in-app Chromium browser, against the disposable PostgreSQL project and real Better Auth/server services. Synthetic accounts only. Web localhost3001, API localhost3002. Existing unrelated SSH listener on3000 was preserved. This proves the identity journey, not later domain-resource authorization or v1 completion.

## Observed behavior

1. With API unavailable, login showed a connection failure and Retry status. Starting the API and retrying produced the signin form.
2. The synthetic admin signed in and reached Dashboard with invitation controls.
3. Issuing an email-bound invitation produced its one-time token, expiry and hide/revoke controls. Hiding removed the token from the rendered page. Copy reported success, but the automation clipboard read returned no usable token; clipboard contents were not verified. The second synthetic token was retained transiently inside browser automation from its visible field for the signup scenario, never written to evidence, URLs or shell output.
4. Invalid invitation signup stayed on Create account with a safe error. A subsequent valid invitation created the synthetic member, accepted enrollment and navigated to Dashboard.
5. The member dashboard contained no invitation/admin controls. At1280px, document width equaled viewport width.
6. The harness's fixed synthetic member removal invalidated sessions. Reloading Dashboard redirected to signin.
7. Signing in with the removed account opened Join this installation. Replaying its consumed invitation failed with a safe explanation. Clicking Dashboard retained the repair screen.
8. The admin issued and revoked an unused invitation; the UI confirmed Invitation revoked and cleared its token view.
9. A fresh invitation for the existing removed member restored active membership through the repair form and navigated to Dashboard.
10. Signout completed. Test tokens were cleared from automation variables and input fields before retained screenshots.
11. After the client-theme correction, Light set the document class/color scheme to light and survived reload; Dark set both to dark; System matched the browser's dark preference. A subsequent reload added zero warning/error console records.

## Responsive findings and artifacts

- `unavailable-320.png`: connection failure/retry state at320px.
- `signin-320.png`: empty signin form at320px.
- `admin-hidden-token-320.png`: original narrow admin state; header account name forced horizontal overflow. Its full-page screenshot is380px wide. Preserved as the reproduced failure.
- `member-active-desktop.png`: active member without admin controls at1280px.
- `removed-member-replay-768.png`: safe consumed-invitation denial, cleared token field, at768px.
- `invitation-revoked-768.png`: admin revocation confirmation at768px.
- `member-repaired-768.png`: successful repair at768px.
- `admin-menu-fixed-320.png`: corrected account menu opened with Enter; full accessible account name, email and Sign Out remain available. Both document width and viewport width measured320px.
- `admin-fixed-desktop.png`: corrected desktop header at1280px; tablet and desktop document widths measured768/1280px respectively, matching their viewports.

No retained screenshot contains an invitation token or password. Synthetic emails and non-secret invitation IDs may appear. Loading/error/success, focus movement to headings, and absence of admin controls were observed; this is not a comprehensive accessibility audit.

## Resource outcome and acceptance limit

Coordinator browser server session24513 printed READY, synthetic removal PASS, and `PASS identity browser fixture cleanup and close`. Its exact disposable container and network were removed with the Compose cleanup receipt. Owned web session78884 stopped with Ctrl-C. The outer browser launcher exited2 after its file was edited for a new mode while Bash still had it open; it reported an EOF parse error after runner shutdown. The current launcher separately passes `bash -n`. This is a coordination failure, not an accepted clean launcher result; a fresh fixed-source start/stop must exit0 before harness acceptance. Do not edit a running shell launcher's source.

## Fixed-source follow-up

Fresh coordinator browser session99641 and web session81189 used the corrected header and stable launcher source. Wrong-password signin showed a safe retry error; correct admin signin succeeded. The320px account menu opened with Enter and closed with Escape; no horizontal overflow remained. Tablet768px and desktop1280px retained the complete account name through its accessible label. The actual screenshots above record the corrected state.

After signout, session99641 printed READY, fixture cleanup/close PASS and exact Compose container/network cleanup PASS, then exited0. Web session81189 stopped with Ctrl-C. Temporary viewport override was reset and the test tab closed. This resolves the prior coordination/lifecycle failure for the fixed source; it does not erase the failed receipt.

Coordinator independently verified the new credential-operator CLI's six actual scenarios with exit0 and exact cleanup; see `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G001-preserve-all-existing-tracked-untrac/a1/coordinator-identity-receipt.md`. Cross-owner domain-resource access remains a requirement of its real consumers.

## Final privacy, transaction and transport corrections

Independent review subsequently found invalid-invitation signup could enumerate existing accounts. Root reproduced the differing422/400 responses; the red receipt is retained at the current attempt's `signup-enumeration-red.md`. The corrected pre-endpoint gate, transactional adapter and safe unexpected-error boundary were independently checked with `bash scripts/verify-identity-auth.sh auth`, session98115: all7 actual Better Auth/PostgreSQL scenarios passed, followed by exact cleanup and exit0. This includes uniform known/unknown invalid-invitation denials, trailing-slash behavior, trusted `views://mainview` signin/session/logout, and forced credential-insert failure with zero attempted console diagnostics, no orphan account and successful retry using the same invitation. This is actual HTTP origin compatibility, not a native desktop UI claim.

On the final product source, fresh browser fixture75714/web75376 passed admin signin, invitation creation, logout, invited-member signup, session refresh, authenticated acceptance, member logout and member signin. `final-transactional-signup.png` captures the resulting member Dashboard without admin controls. Tokens remained transient and were cleared. Fixture75714 closed and removed its exact Compose resources, exit0.

For the transport failure path, a separate short-lived loopback fault server returned JSON headers plus an unfinished body. This is an explicit network-fault fixture, not a real auth/DB integration result. The actual browser's header signout showed `Could not confirm sign out. Check your connection, then try again.` after20125ms, preserved the page, and made Sign Out available for a deliberate retry. Server36423 observed exactly one signout request. Browser warning/error count was0. `auth-stalled-body-recovered.png` records the visible repair message. The first observation missed the transient toast and is inconclusive; a second condition-wait captured it. No automatic action retry was observed.

Owned fault server36423 stopped with exit0, web75376 with Ctrl-C/130; temporary browser tab2 closed. `lsof` reported no listener on3001 or3002. The earlier fault server5220 also exited0 under its fixed60-second deadline. No production service, real account or unrelated listener was modified. Independent final review accepts the correction delta with WATCH for nonblocking brittle test assertions; its final browser receipt is being integrated.

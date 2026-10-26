# RFC-004f3: Prepare disposable identity browser QA

Parent: [004f](004f-connect-enrollment-status-and-login.md). Status: review; actual disposable startup, anonymous HTTP status and clean shutdown verified. Browser enrollment remains pending. Consumes accepted enrollment/preflight/admin/credential services and [004f1](004f1-serve-enrollment-and-access.md). Coordinator authorized logging fixes and this bounded browser harness under the user's v1 continuation instruction.

## Completion record

Changed paths: `apps/server/src/app.ts`, `app.test.ts`, `modules/identity/routes.test.ts`, `test-support/identity-browser-server.ts`, `test-support/identity-browser-server.test.ts`, `scripts/verify-identity-auth.sh`, `scripts/verify-identity-auth.test.ts`, this document. No production environment, real account, database, container or browser was started by this slice. No installs, commits or staging.

### Logging corrections

Reproduced before fixing: a forwarded 401/202 Response was recorded by evlog as 200; telemetry session resolution called `console.warn` with a synthetic private driver exception. Three failing regression tests are captured in `red.txt` below.

`createApp` now supplies a telemetry-only session wrapper that returns null on resolution errors. Actual identity access retains the original auth service and returns 503 on lookup failure. No exception reaches the third-party telemetry middleware; production code does not patch console. A global response mapping hook copies Response.status into Elysia set.status before evlog's after-response event. Original auth response/cookies remain intact. Tests compare drained statuses for 401/202 auth responses and 401/403/400/201/200/409 identity responses; parser failure remains 400 and session failure remains 503. Token/body privacy assertions remain enabled.

### Browser runner contract

The new runner is opt-in and inert on import. It calls the existing `requireIdentityAuthProofTarget` before timers, runtime imports or I/O, then `openIdentityProof` verifies/reserves the fresh dedicated database and applies only its pinned migration. It provisions exactly one synthetic admin with `createOperatorCredentialProvisioner`, then bootstraps via `createAdminLifecycleService`. Public auth uses real `createAuthOptions` plus invitation preflight, real Better Auth, `createApp`, membership lookup and enrollment transactions. Production env/services are never imported. Auth telemetry/library logging and external event drains are disabled; cookie and CSRF/origin options are preserved.

Browser fixture endpoints: API `http://localhost:3002`, approved web origin `http://localhost:3001`. API binds only 127.0.0.1. There are no seed/control HTTP routes. Port conflicts fail and clean up; do not stop unrelated listeners. Browser cookie behavior on localhost remains a required live check.

Only synthetic credentials for the coordinator's manual browser input:

- Admin email: `browser-admin@identity.invalid`
- Admin password: `Synthetic-Browser-Admin-2026!`
- Member to invite/signup: `browser-member@identity.invalid`
- Suggested member password: `Synthetic-Browser-Member-2026!` (not pre-provisioned; create through the gated UI)

These values belong exclusively to the disposable fixture. The runner never prints credentials, auth responses, tokens, hashes or database URLs.

### Exact startup and shutdown

Coordinator starts this only when web/browser QA is ready, from repository root with an interactive stdin kept open:

```sh
bash scripts/verify-identity-auth.sh browser
```

The launcher preserves the existing fixed project checks: refuse any existing `zetta-identity-tests` container/network/volume, validate environment before provisioning, use the existing local image without pulling, verify exact ownership/loopback-port/tmpfs metadata and live tmpfs filesystem. Unknown mode/extra arguments fail before Docker. Default auth, operator and credentials modes remain available unchanged.

Wait for the fixed line `READY identity browser fixture http://localhost:3002`. Start/use the separately owned web development server on port 3001 with API origin port 3002. Browser steps: admin signin; issue invitation through the authorized API/UI; sign out; member signup with invitation; authenticated acceptance; status active; replay/wrong-token denial; signout/signin. Do not copy invitation tokens into URLs, evidence or terminal logs.

While the harness is running, stdin accepts exact lines only:

```text
remove-member
stop
```

`remove-member` is a test-only removal fixture, not product admin UI. It locks singleton first and atomically removes only the fixed synthetic member (never the admin), deletes that member's stored sessions, and prints `PASS test-only synthetic member removal and session invalidation`. Missing/inactive member fails closed and shuts down. Verify removed-session denial, then signin yields unenrolled status. Other commands print only a fixed rejection and do nothing.

`stop`, stdin closure, SIGINT or SIGTERM requests shutdown. After 14 minutes the runner automatically requests shutdown; a hard 15-minute deadline covers startup and cleanup, terminating with failure if needed. Shutdown closes input, settles any removal operation, stops the listener, cleans the eight owned fixture tables and closes proof connections before `PASS identity browser fixture cleanup and close`. The outer launcher then tears down only its dedicated project and prints its existing Compose cleanup receipt. Wait for both receipts and exit 0; failure/forced deadline is not successful QA. Do not run any other identity proof concurrently against the same fixed project/port.

### Evidence and verification

Evidence directory: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G001-preserve-all-existing-tracked-untrac/a1/identity-browser/`.

| Scenario | Invocation | Binary observable | Artifact |
| --- | --- | --- | --- |
| Reproduce telemetry leak and wrong status | `bun --no-env-file test apps/server/src/app.test.ts` before fix | 3 failing tests: two statuses, one console warning | `red.txt` |
| Fix private auth exception while preserving 503; forwarded/identity statuses and privacy | Combined test command below | All status and no-warning/no-token assertions pass | `tests.txt` |
| Harness inert import and missing target | Same combined command; subprocess guards timers/sockets/fetch | exit 1, fixed target-validation stderr, empty stdout; no startup | `tests.txt` |
| Fixed browser launcher, existing-resource/unsafe-env refusal, teardown success/failure and existing modes | Same combined command | Shell-control and actual metadata-predicate assertions pass; no Docker spawned by fixtures | `tests.txt` |
| Strict source diagnostics | Command below | exit 0 | `types.txt` |

```sh
bun --no-env-file test apps/server/src/app.test.ts apps/server/src/modules/identity/routes.test.ts apps/server/src/test-support/identity-browser-server.test.ts scripts/verify-identity-auth.test.ts
```

The existing route test starts an ephemeral loopback listener with synthetic services and closes it. It is not the new browser harness and does not prove real DB/auth/browser readiness. The subsequent live check below verifies only real startup, anonymous HTTP and cleanup; removal and browser enrollment still require coordinator evidence.

Initial offline result: 33 pass, 0 fail, 312 assertions across four files. Strict diagnostics exit 0.

```sh
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/app.ts apps/server/src/app.test.ts apps/server/src/modules/identity/routes.test.ts apps/server/src/test-support/identity-browser-server.ts apps/server/src/test-support/identity-browser-server.test.ts scripts/verify-identity-auth.test.ts
```

LSP edit hook timed out on the shell file; installed strict TypeScript and the launcher's Bash syntax test are the verification evidence. No LSP success or real-browser outcome claimed.

### Live startup repair and proof

Coordinator's first actual launch failed before READY. A second `bash scripts/verify-identity-auth.sh browser` launch reproduced exit 1 after ownership/tmpfs checks. Splitting safe phase labels showed `listener startup`; `lsof -nP -iTCP:3000 -sTCP:LISTEN` identified an existing unrelated SSH listener. It was preserved. Coordinator approved fixed API port 3002 and corresponding web configuration. The runner now preserves the original failure phase through cleanup, so startup failure is distinguishable without printing exceptions.

`COMPOSE_PROGRESS=plain bash scripts/verify-identity-auth.sh browser` with interactive stdin and output captured to `live-start-stop.txt` reached `READY identity browser fixture http://localhost:3002`. While running, a Bun fetch of `http://localhost:3002/api/identity/status` asserted response status 200, body state anonymous and Cache-Control no-store; only `PASS live disposable identity status: 200 anonymous no-store` was emitted (`live-http.txt`). Sending `stop` on stdin yielded both fixture cleanup/close and dedicated Compose cleanup receipts, launcher exit 0. This exercised actual operator credential provisioning, bootstrap, gated auth initialization and the real app listener against the owned PostgreSQL fixture. No signin or browser enrollment success is inferred.

The launcher verified its container/network cleanup before exiting 0. A later independent inventory check encountered a new healthy project; coordinator confirmed it belongs to the fresh browser-QA session 24513. That new instance was left untouched, and no empty-inventory claim is made. This worker's session 13591 is stopped. Final focused command `bun --no-env-file test apps/server/src/test-support/identity-browser-server.test.ts scripts/verify-identity-auth.test.ts` passed 11 tests/106 assertions (`repaired-harness-tests.txt`); the strict command above narrowed to those three harness/launcher TypeScript files exited 0 (`repaired-harness-types.txt`).

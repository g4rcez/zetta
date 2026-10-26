# RFC-004e2: Existing-account installation-operator command

- **Parent:** [004e](004e-bootstrap-and-recover-installation-admin.md), within RFC-004.
- **Prerequisites:** accepted [004e1 lifecycle transactions](004e1-implement-admin-lifecycle-transactions.md), accepted target-guard pattern and existing identity storage/lock contracts.
- **Status:** accepted source after the P1 correction, independent re-review and coordinator verification. Parent/root remain incomplete; actual CLI/SQL proof has not run.

## Goal and approved boundary

Provide one inert-on-import local operator CLI/lifecycle seam for explicit already-provisioned account IDs. User approved progressive identity source/native focused checks and a separately controlled local disposable auth proof, then continued this exact bounded command implementation. No repeated approval request is needed for the approved source choices. The coordinator owns new dedicated CLI runtime proof only after review and actual target approval. Previously accepted five-check auth proof was not rerun.

Trusted OS execution/DB access is the operator boundary; no flag, body field or acknowledgement authenticates an operator. Explicit `ZETTA_OPERATOR_DATABASE_URL` plus exact `ZETTA_OPERATOR_ALLOW_MUTATION=identity-admin`, no app DB fallback/dotenv. First command permits canonical local loopback/localhost/trusted-tunnel URLs only, rejects ambient PG/native overrides, pins driver target/session fields and returns no sensitive values. See the [runbook](../docs/operations/identity-admin.md) for complete input, target, timeout and failure contracts.

## Bounded paths

Command implementation paths, including the narrow P1 close-completion correction:

- `apps/server/src/modules/identity/admin-operator.ts`: pure target/input checks, bounded fatal UTF-8 stream reader and injected single-attempt dispatch/cleanup.
- `apps/server/src/modules/identity/admin-operator-cli.ts`: `import.meta.main`-guarded real composition. Dynamic DB and lifecycle imports only inside the validated opener; no app startup/auth services.
- `packages/db/src/admin-operator-client.ts`: one max-1 owned Pool, one reserved PoolClient, fixed parameterized selected database/user/session-user readback, real installed Drizzle/relations and `Pick<Database,"transaction">` without Database/unknown casts. No schema/migration/reset/truncate or target discovery.
- `packages/db/src/admin-operator-client-owner.ts`: minimal DB-owned lifecycle contract for error/termination observation, reservation and idempotent close; actual driver construction/SQL remain in the opener.
- `apps/server/src/modules/identity/admin-operator.test.ts` and `packages/db/src/admin-operator-client.test.ts`.
- This child and `docs/operations/identity-admin.md`.

No accepted service/auth/schema/startup, package manifest, dependency/lockfile or parent/root status edits. Existing unrelated modifications and untracked paths preserved; nothing staged.

## Contract exported

`runAdminOperator(args, env, deps): Promise<0|1>` accepts exactly `bootstrap` or `replace`; `--help` alone returns static usage offline. Bad arguments/target/TTY deny before stdin, timer or client. Complete stdin validation precedes opener/runtime DB imports. `requireOperatorTarget` returns frozen explicit driver fields, not a returned/logged URL. `DATABASE_URL` is intentionally ignored, not a same-DB protection; future actual application target execution still needs approval.

`parseOperatorInput` accepts only `{userId}` for bootstrap, or `{expectedAdminUserId,newAdminUserId,reason}` for replace. Exact nonempty trimmed/control-free IDs; distinct old/new IDs. CLI reason is only `admin-unavailable` or `planned-transfer`; service remains general. No credential/password/authority keys. Whole input is at most 4096 UTF-8 bytes; fatal streaming decoding handles split multibyte sequences and cancels/releases on overflow/error/abort. TTY is rejected.

Real CLI has a 20-second hard process deadline covering stdin/imports/operation/cleanup. Owned pg settings: 3-second connect, 4-second statement, 2-second lock, 5-second query/idle-in-transaction, explicit SSL false/negotiation, UTF-8, public search path and app name. All `/^PG/i` env keys and `NODE_PG_FORCE_NATIVE` deny before driver import. Error flags persist through close; initialization errors also attempt release/end. The client termination observer is registered on pool connect before reservation. Close waits for both pool shutdown and the reserved client's observed end, including an end already observed before reservation; shutdown rejection does not short-circuit the termination wait or hard deadline. There are no retries.

Output: fixed phase-only unavailable label/exit 1; success label/exit 0 only after service commit resolves, health, successful close and final health. No URL, credentials, input, reason, returned IDs, SQL/driver message or cause is logged. Failure after commit/close/deadline **may have committed**. Runbook mandates approved state inspection before any retry; forced deadline cannot guarantee completed cleanup or rollback.

## Completion record

**Accepted source only, not runtime accepted.** Installed facts: Bun 1.3.14; Drizzle 1.0.0-rc.4 and TypeScript 6.0.3 remain unchanged. The pg manifest range is `^8.23.0`, but the installed package inspected here is **8.23.1** (not assumed 8.23.0). Its connection-parameters implementation honors the explicit fields/SSL negotiation; installed Drizzle explicit PoolClient overload typechecks against the service's transaction-only Pick. No casts or substitute Pool are needed. LSP tools are unavailable; used installed targeted strict no-write TypeScript diagnostics instead.

### P1 close-completion correction — reviewed and accepted as source

Independent review `/tmp/zetta-rfc004e2-review.md` blocked the initial implementation: installed pg-pool **3.14.0** removes a client from its internal list before its asynchronous end callback, so `pool.end()` can resolve before actual client termination. Initial success/final-health/deadline cancellation could therefore precede a later error. Inspected installed `_pulseQueue`/`_remove`, connect emission before handoff, and pg **8.23.1** client end emission; no driver-private flags are used by the fix.

The correction adds only the minimal typed lifecycle helper, wires it into the existing DB opener, expands the focused DB test file, and updates this child evidence. No server dispatcher, CLI, runbook, auth/schema/proof client, parent/root, package or dependency changes. Persistent error listeners remain active. The helper retains the termination promise observed at connect, preserves idempotent release/shutdown, and uses `Promise.allSettled` so an early shutdown rejection cannot cancel the cleanup deadline while reserved termination is still pending. The existing dispatcher already awaits close, checks final health and then clears its deadline; it needed no change.

Correction commands/results:

1. TDD red after extracting the old lifecycle behavior into the structural helper, before adding termination observation:
   ```sh
   bun test packages/db/src/admin-operator-client.test.ts --test-name-pattern 'pool end alone|late error after pool end'
   ```
   **0 pass, 2 fail, 2 filtered, 4 assertions.** The delayed-end test received exit 0 before client end; the late-error test found success already printed. These behaviorally reproduce P1, not source-string failures.
2. Same command after correction: **2 pass, 0 fail, 2 filtered, 27 assertions.**
3. `bun test packages/db/src/admin-operator-client.test.ts`: **10 pass, 0 fail, 96 assertions.** Every changed/new DB test ran.
4. `bun test apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.test.ts`: **19 pass, 0 fail, 304 assertions (163 ms).** Native EventEmitter/structural ownership fixtures exercise pool-end-before-client-end, late client/pool errors, release/pool-end rejection with termination pending, already-observed end before reservation, same-promise idempotence, reverse completion order, synchronous end during release, modeled failed readback/handshake cleanup and hard-deadline retention. They compose the actual dispatcher with the lifecycle helper; no global/shared module mocks, fake full Pool or type assertions conceal the seam.
5. Strict targeted diagnostics, exit 0/no output; LSP unavailable:
   ```sh
   packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/admin-operator.ts apps/server/src/modules/identity/admin-operator-cli.ts apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.ts packages/db/src/admin-operator-client-owner.ts packages/db/src/admin-operator-client.test.ts
   ```

Correction whitespace/no-stage evidence and full findings: `/tmp/zetta-rfc004e2-close-fix.md`. These are source-only/offline checks. Initialization readback/handshake errors are modeled in fixtures, with the actual opener catch/close/readback wiring checked in source; neither actual `Pool.connect()` nor SQL was executed. Independent follow-up `/tmp/zetta-rfc004e2-close-followup-review.md` found no issues and resolved the initial P1. Coordinator independently passed19 tests/304 assertions, the exact strict no-emit command above and whitespace checks, then accepted source only. Actual driver/client termination and CLI SQL remain unverified.

### Initial implementation commands and results (historical, before P1 review)

1. TDD red: `bun test apps/server/src/modules/identity/admin-operator.test.ts` before implementation: expected missing `./admin-operator`, 0 pass/1 fail/1 module-resolution error. No connection/auth factory ran.
2. Same command after implementation: 8 pass/0 fail, 175 assertions.
3. Expanded two-file run initially had 10 pass/1 fail: a source-only negative regex matched the comment `No connectionString:` rather than a config property. Narrowed assertion to a property line. Initial targeted tsc also caught a test reason literal widened to `string`; narrowed the test array with `as const`. Neither correction changed product behavior.
4. Final focused command:
   ```sh
   bun test apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.test.ts
   ```
   **11 pass, 0 fail, 218 expect() calls, 2 files (215 ms).** No DB, Pool construction/connect, auth factory/context, provider or network operation. Importing driver/options is not opening it.
5. Final strict diagnostics, exit 0/no output:
   ```sh
   packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/admin-operator.ts apps/server/src/modules/identity/admin-operator-cli.ts apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.ts packages/db/src/admin-operator-client.test.ts
   ```
6. Whitespace/no-stage validation is recorded in the external implementation report `/tmp/zetta-rfc004e2-implementation.md`: `git diff --check`, scoped new-file whitespace assertions and `git diff --cached --name-only`. No root check/build/full suite or write formatter was used.

### Evidence classification

- Behavioral fixtures: exact arguments/extra authority/input fields, allowed reason codes, malformed/control/trimmed/same IDs, exact 4096-byte boundary/oversize JSON; URL default-port/explicit target/no fallback, canonical encoding, host/path/query/fragment/normalization/ambient override denials; exact method arguments and one-attempt dispatch; injected input/open/service/commit/health/close/post-close failures, cleanup count, opaque output, deadline abort/termination.
- Real stream primitives: split UTF-8, exact byte cap, overflow, invalid/truncated UTF-8, stream error, cancellation and unlocked reader. No unbounded `.text()` on actual stdin.
- Fresh subprocesses with `--no-env-file`, controlled synthetic env and throwing stdin/network/listen/fetch/timer guards: CLI/DB imports inert; actual CLI invalid args/missing target cannot touch forbidden IO; static help succeeds. No valid target mutation subprocess was executed.
- Driver-option assertions and **source inspection only** for opener initialization catch/close wiring, parameterized readback and transaction-only Drizzle composition. The P1 correction additionally behaviorally exercises the actual lifecycle helper and dispatcher with structural EventEmitter resources, not a real pg Pool. Modeled initialization failures do not execute readback SQL or a driver handshake. These are not execution evidence for actual driver/backend termination, SQL, operator credentials or PostgreSQL rollback. Runtime dependencies are type-only in the pure module; real composition imports them after validation.

### Remaining gates / next consumer

Initial review was BLOCK; the corrected source passed independent follow-up and coordinator checks. Next is a separately controlled dedicated disposable actual-target CLI proof, but the user requested a checkpoint and stop after this correction. **004e3 is not started.** Resume from [the checkpoint](../docs/checkpoints/identity-foundation.md) only after the user resumes work. Existing auth proof is accepted and untouched, not reused as CLI/credential evidence. Physical SQL transactions, constraints/unique-winner and concurrency, singleton-first coordination with invitation operations, actual session/cookie/cache invalidation, trusted operator/DB credentials and live cleanup need the appropriate approved runtime evidence. Parent RFC-004/004e remain incomplete.

Credential provisioning remains entirely unimplemented. Installed Better Auth admin-plugin `createUser` requires a plugin absent from the current factory's `plugins: []` and separately reviewed auth/schema work; no plugin, credential insert/hash, account creation or public route is added. The next consumer must not execute against production, migrate/reset a target, claim fixture success is SQL/credential proof, or retry an uncertain outcome without approved state inspection.

Skipped as required: accepted five-check auth proof rerun; any DB/Docker/network/auth/provider/provisioning or actual mutation; install/dependency/lockfile changes; migrations/schema/DDL; app startup edits; full suite/build/root check; worktrees/subagents/staging/commits/deployment.

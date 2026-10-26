# RFC-004e7: Verify credential-creating admin command

Parent: [004e](004e-bootstrap-and-recover-installation-admin.md). Prerequisites: credential helper/runtime 004e4–004e5 and command 004e6.

## Approved boundary

Coordinator assigned new `credential-operator.integration.ts`, its focused guard test and this record, then transferred ownership of the shared launcher and its test after the browser worker finished. The user authorized local disposable synthetic verification. No existing proof helper, schema, auth source, application route or service changes. Reuse `requireIdentityAuthProofTarget` and `openIdentityProof` unchanged: fixed target, reserved verified clients, advisory ownership, empty target and pinned migration remain mandatory. No production execution or installs.

## Scenarios

1. Real CLI with closed but extra-authority input returns exact input denial with zero rows.
2. Actual non-TTY closed JSON subprocess bootstrap creates one user/credential, active admin membership, singleton and operator audit, no session; actual Better Auth password signin succeeds afterward.
3. Case-normalized duplicate replacement denies at provisioning, preserves counts/identity, rejects alternate password and retains original password. No adoption.
4. Stale expected old admin denies at activation, leaving the committed new credential account unentitled and original authority unchanged.
5. Proof-owned audit CHECK failure rolls activation back while preserving the newly created unentitled credential account; fault constraint is removed in finally.
6. Owner holds singleton lock while replacement subprocess creates its new account. An observed pg_stat_activity lock proves CLI activation is waiting after provisioning commit. Real cookies for old admin, newly created replacement and unrelated orphan control authenticate before release. After CLI completes, old/new cookies return null, control remains authenticated, old member remains ordinary active, singleton/audit point at replacement, and both affected users' stored sessions are absent.

Only exact phase labels/exit status pass. Child stdout/stderr capture is bounded to 4096 bytes; assertions never print unexpected child output. No secrets or raw hashes are read into proof output. Child processes have 25-second timeout, the executable retains its 20-second deadline, parent has 90 seconds including child settlement and owner cleanup. No blind retries/deletes. Parent finally kills running children and settles them before fixture cleanup/close.

## Completion record

Status: source, offline checks and all six actual disposable runtime scenarios pass. Independent review remains pending. Root RFC-004/004e status remains coordinator-owned.

New launcher mode: `bash scripts/verify-identity-auth.sh credential-operator`, dispatching exactly `apps/server/src/modules/identity/credential-operator.integration.ts`. Existing auth/operator/credentials/browser modes remain. Fixture tests verify fixed dispatch, pre-provision denial, failure exit retention and teardown for the new mode alongside all existing modes.

Focused command:

```sh
bun --no-env-file test apps/server/src/modules/identity/credential-operator.integration.test.ts apps/server/src/modules/identity/credential-operator.test.ts scripts/verify-identity-auth.test.ts
```

Result: 26 pass, 0 fail, 219 assertions. New guard tests fail first before module exists; final tests prove inert imports, missing-target/test-mode rejection before any timer/network/child attempt, and sticky guard detection even if an IO error is swallowed. They do not open PostgreSQL or call Better Auth.

Strict diagnostics:

```sh
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/credential-operator.integration.ts apps/server/src/modules/identity/credential-operator.integration.test.ts scripts/verify-identity-auth.test.ts
bash -n scripts/verify-identity-auth.sh
```

Final exit 0. Initial strict diagnostics identified a redundant Promise truthiness assertion and inferred optional fixture keys; both were corrected without type assertions. Source LSP reports no diagnostics.

Artifacts: current attempt directory `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G001-preserve-all-existing-tracked-untrac/a1/`, prefix `credential-cli-proof-`: `red.log`, `tests.log`, `types.log`, `validation.log`, and `evidence.md`. Final runtime receipt is `credential-cli-proof-runtime.log`: all six named checks, owned cleanup and launcher exit 0. `credential-cli-proof-source.sha256` fingerprints final proof, command, launcher and relevant dependency source.

Limits: actual CLI source uses no route. The proof uses real in-process Better Auth handler for authentication, not browser transport. Cookie-cache-enabled mode, in-flight cancellation and production targets are outside this proof. Root RFC-004/004e completion remains coordinator-owned.


### Actual runtime handoff

Exact command: `bash scripts/verify-identity-auth.sh credential-operator`, with authorized Docker access after the coordinator released the shared project. The launcher verified fresh Compose project ownership, fixed loopback port, PostgreSQL 18 tmpfs filesystem and health; `openIdentityProof` verified service identity, empty schema and pinned migration. Each subprocess invoked the actual new credential CLI under `--no-env-file` with explicit selected test environment and closed non-TTY JSON stdin. No real user credentials were used.

Final source passed all six named scenarios, followed by `PASS actual credential operator CLI proof (6 checks); synthetic rows only`, owned container/network cleanup and `launcher exit=0`. Child assertions require exact command exit/stdout/stderr and bounded capture; no child IDs, passwords, hashes or raw responses are printed. PostgreSQL and actual Better Auth signin/cookie requests verify effects independently of the command's receipt.

Runtime history: initial run passed five checks and failed generically in the replacement scenario; cleanup succeeded and exit 1 is preserved in `credential-cli-proof-runtime-first.log`. Adding safe subphase diagnostics yielded a six-check pass. Review found a fragile final membership assertion comparing PostgreSQL random-ID collation with JavaScript lexical ordering; it now projects exact previous/new membership identity and orders a boolean. The initial failure was not conclusively localized, so that collation issue is a suspected explanation, not a proven diagnosis. The entire six-check scenario was rerun successfully on this final assertion/source. All failed and final runs cleaned their owned resources.

No launcher edits occurred during these runs. The coordinator was told the final project was clear before its separate browser rerun. Earlier browser-run shell status is not part of this proof and is not claimed as success here.

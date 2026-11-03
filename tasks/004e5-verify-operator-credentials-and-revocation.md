# RFC-004e5: Verify operator credentials and effective revocation

- **Parent:** [004e](004e-bootstrap-and-recover-installation-admin.md).
- **Prerequisites:** [004e4](004e4-provision-operator-credentials.md) provisioning source; accepted existing-account admin lifecycle and disposable database ownership.
- **Scope:** new `credentials` mode only. Do not rerun or replace the accepted five-check auth or six-check operator proofs.

## Acceptance scenarios

1. Actual supported operator signup creates one library credential and no session, membership, admin or audit authority.
2. An audit failure during bootstrap rolls back lifecycle work and preserves the deliberately created unentitled account.
3. Duplicate signup denies without adopting or overwriting the existing account; original password signs in, alternate password denies.
4. Forced credential account insertion failure rolls back the newly created auth user through adapter `transaction:true`.
5. Concurrent same-email signup uses two independent reserved connections and a real observed lock barrier; exactly one succeeds, one denies, and winner credentials persist.
6. Existing invitation policy rejects missing, malformed and nonexistent invitation input without writes or cookies.
7. Real stored-session cookies for old/new admin both lose authentication after replacement, while an unrelated control cookie still authenticates.

## Completion record

The source is bounded to a standalone opt-in proof, offline guard tests, closed launcher mode and this record. User's v1 continuation authorizes the fresh dedicated disposable test target; no production account or database is selected.

The proof uses the accepted target/environment guard and `openIdentityProof`. It reserves three verified PostgreSQL connections, uses only the fixed pinned test migration, and denies new sockets/DNS/HTTP/fetch/listeners after setup with a sticky attempted-IO flag. A 90-second deadline covers cleanup. Concurrent work settles before fixture cleanup, and driver close uses the accepted termination barrier. The owned fault constraints are removed in `finally`.

Offline guard tests detect attempted IO even if its exception is swallowed. Launcher fixtures verify fixed credentials dispatch, unknown/extra-argument denial and teardown on failure. These fixtures do not execute auth or DB work.

Final commands, actual receipt and source identity are recorded below.

### Verified handoff

Status: implemented and actual disposable runtime verified; independent review remains pending. Parent RFC-004/004e still requires integrated operator CLI/product acceptance.

Changed paths: `apps/server/src/modules/identity/credential-provisioning.integration.ts`, its `.test.ts`, `scripts/verify-identity-auth.sh`, its `.test.ts`, and this RFC. The auth/database/lifecycle source was reused unchanged by this worker. Another worker narrowed `createAuthOptions`' database parameter to omit `$client`, allowing the reserved PoolClient database without casts. The proof uses the actual production cookie/invitation configuration; only logger/telemetry are disabled. No extra helper, manifest, dependency, schema, route or product factory behavior changed here.

Artifacts are under `local evidence`:

- `credential-proof-runtime.log`: exact actual seven-check receipt and Compose ownership/tmpfs/cleanup output, exit 0.
- `credential-proof-tests.log`: final 76 pass, 0 fail, 568 assertions across seven files, exit 0.
- `credential-proof-types.log`: strict targeted TypeScript exit 0, no diagnostics.
- `credential-proof-validation.log`: shell syntax, whitespace and LSP results.
- `credential-proof-source.sha256`: source/dependency fingerprints for this proof.
- `credential-proof-evidence.md`: scenario/invocation/observable mapping.

Final focused invocation:

```sh
bun --no-env-file test apps/server/src/modules/identity/credential-provisioning.integration.test.ts scripts/verify-identity-auth.test.ts packages/auth/src/operator-provisioning.test.ts packages/auth/src/index.test.ts packages/auth/src/invitation-policy.test.ts apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.test.ts
```

Final strict diagnostics:

```sh
packages/db/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/identity/credential-provisioning.integration.ts apps/server/src/modules/identity/credential-provisioning.integration.test.ts scripts/verify-identity-auth.test.ts
bash -n scripts/verify-identity-auth.sh
git diff --check
```

Source LSP reported no diagnostics. Initial strict check exposed the server package's inability to resolve the auth-owned adapter directly; the proof now uses production `createAuthOptions` rather than adding a helper/dependency. Final strict command above passes. No runtime attempt used the failed version.

Actual invocation (authorized escalation for Docker socket):

```sh
bash scripts/verify-identity-auth.sh credentials
```

Exit 0. The fresh project was `zetta-identity-tests`, PostgreSQL 18, loopback port 55432, database `zetta_identity_test`, role `zetta_identity_runner`, tmpfs-only storage and the fixed pinned migration. The launcher refused pre-existing resources, used the existing image with `--pull never`, verified the actual filesystem, then removed its container/network and confirmed their absence. No volumes were removed.

The concurrent case took a SHARE lock on the user table through the owner connection, observed both distinct reserved connections blocked on actual user INSERTs, released the lock and settled both attempts. Exactly one returned a verified ID; one returned an opaque failure. The winner's password authenticated, the loser's password denied, and exactly one user/account remained. This is observed database concurrency, not scheduled fake results.

The rollback case applied proof-owned `credential_proof_account_fault CHECK(false) NOT VALID`, invoked the real provisioning factory, required opaque denial, unchanged counts and absent attempted user, then removed the constraint in `finally`. Failed bootstrap similarly used proof-owned `credential_proof_audit_fault`, required lifecycle failure and unchanged counts with the new account still present, and removed the constraint in `finally`.

For revocation, the actual installed handler issued secure HttpOnly SameSite=None cookies to old admin, replacement and unrelated control. All authenticated before replacement. After the accepted lifecycle transaction, replaying the same old/new cookies returned null sessions while the control still returned its own ID; SQL independently confirmed both selected users' sessions absent. Bootstrap itself does not delete sessions; replacement performs the tested revocation.

Limits: in-process real Better Auth handler requests, real password hashing/signin and real PostgreSQL are proven; no browser/native transport, cookie-cache-enabled configuration, in-flight request cancellation or production target is claimed. This proof invokes the accepted lifecycle service rather than a credential-creating operator CLI; that integration remains separate. Public signup checks use actual production invitation policy but do not replay the accepted full enrollment proof. No auth/operator proof rerun, installation, staging, commit, worktree or deployment occurred.

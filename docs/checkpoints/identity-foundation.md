# Identity foundation checkpoint

Snapshot: **2026-10-22 UTC**. This is a resume handoff, not a second task-status authority. [TASKS.md](../../TASKS.md) remains the root authority; child records contain detailed evidence.

## Current checkpoint

The user subsequently authorized continuing all remaining work through v1, superseding the previous bounded stop. The pi checkpoint and dirty working tree were preserved. Durable aggregate objective and current resources are tracked in `local evidence`, `local evidence` and the scoped loop ledger.

Since the previous checkpoint, independent 004e3 review and its sticky attempted-I/O regression fix passed. Trusted credential provisioning, actual seven-case password/rollback/revocation proof, the usable credential-admin command and its six-case actual CLI proof are implemented; both live proofs passed independently under the coordinator with exact disposable cleanup. Server status/invitation/access composition and web signin/signup/enrollment repair are implemented. Actual Chromium admin-invite/member-signup, invalid/replayed token denial, removal/session invalidation, fresh invitation repair, revocation, theme and320/768/1280px header checks passed. [Browser receipts](../verification/identity-browser/walkthrough.md) retain both failures and corrections.

**Integrated identity accepted:** signup privacy, transaction rollback/error handling and bounded authentication corrections passed actual final HTTP/browser regressions and [independent WATCH/APPROVE review](../verification/reviews/identity-final-review.md), no blockers. Root RFC-004 and005 are Done for the connected identity and actor/ownership contract. G001 essential criteria passed and its checkpoint is complete; optional future actual domain-query criterionC003 remains pending for consumers. The account-enumeration red receipt and earlier failures remain preserved rather than erased. Production deployment, real accounts and later domain-resource routes are not proved by this acceptance.

Isolation002d independently passed13 actual no-network Docker scenarios and cleanup, including resource pressure and acknowledged-launch recovery. RFC-002's supported research/design is accepted for pure RFC-006; broad aggregateG002 operational isolation is not complete. RFC-006 source is now implemented and independently tested40/88, with code review in progress. The connection-secret ADR is accepted design-only after WATCH review and exact idempotency clarification;007b bounded crypto implementation is active. Six-harness/Jev/Laya/Hermes source research is recorded, with unsupported native/egress/desktop paths still explicit. No identity fixture or web/fault listener remains. Resume from current agent/ledger state before starting another disposable service; never edit a running shell launcher's source.

## Prior checkpoint inventory (historical)

| Work                                                    | Evidence / status                                                                                                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product refinement, wiki and dependency-ordered backlog | 82 root RFCs across 20 modules; planning complete, not implementation complete.                                                                                                                                |
| RFC-001 ownership contract                              | Accepted. One installation membership and explicit sole-admin selection/replacement; workspaces are visual organization, not access boundaries.                                                                |
| RFC-003 test seams                                      | Accepted. Infrastructure-free app composition; production startup remains separate.                                                                                                                            |
| RFC-002 execution isolation                             | **In progress.** Linux-container boundary and bounded synthetic containment proof accepted; real runtime, egress, recovery and six-harness gates remain.                                                       |
| RFC-004a/b                                              | Accepted inactive identity storage and transactional enrollment source.                                                                                                                                        |
| RFC-004c                                                | Accepted SQL-only proof: **14 actual PostgreSQL checks**, including constraints, named races and rollback; dedicated teardown confirmed.                                                                       |
| RFC-004d1/d2                                            | Accepted inactive signup preflight and explicit auth-factory injection. Production callsites remain unchanged.                                                                                                 |
| RFC-004d3                                               | Accepted actual in-process Better Auth/PostgreSQL proof: **5 checks**, summary, exit0 and scoped teardown. User screenshot also shows success. Not browser/native transport or production activation evidence. |
| RFC-004e1                                               | Accepted inactive existing-account bootstrap/replacement transactions.                                                                                                                                         |
| RFC-004e2                                               | Operator command and shutdown correction **accepted as source**, after independent re-review and coordinator checks.                                                                                           |
| RFC-004e3                                               | **Runtime verified:** six actual CLI/SQL checks, scoped teardown, 27 offline tests/366 assertions and strict diagnostics. Synthetic rows only; new independent review remains for integration.                 |
| RFC-004e / RFC-004                                      | **Incomplete.** Credential provisioning, effective cookie/cache invalidation, invitation coordination, production composition/access and connected enrollment UI remain unfinished.                            |
| RFC-005 and later product work                          | Not unblocked by these fixtures; use root task dependencies and current records before starting.                                                                                                               |

Current records: [root RFC-004](../../tasks/004-implement-approved-enrollment-and-admin-bootstrap.md), [004d](../../tasks/004d-gate-auth-signup-with-invitations.md), [004e](../../tasks/004e-bootstrap-and-recover-installation-admin.md), [004e2](../../tasks/004e2-run-existing-account-admin-command.md).

## Current correction

Installed pg-pool **3.14.0** can resolve `pool.end()` before a reserved client's asynchronous termination. The initial operator implementation could therefore clear its deadline and report success too early. The first independent review blocked acceptance.

The correction establishes client-end observation before reservation/release, remembers an already-observed end, retains error flags and makes idempotent close await **both pool shutdown and reserved-client termination**, even when shutdown rejects. The existing dispatcher continues to hold its 20-second hard deadline and reports success only after commit, health, completed close and final health.

Relevant source:

- `apps/server/src/modules/identity/admin-operator.ts`: pure target/input validation, fatal bounded UTF-8 stream reader, injected one-attempt dispatch.
- `apps/server/src/modules/identity/admin-operator-cli.ts`: inert-on-import executable and delayed real composition.
- `packages/db/src/admin-operator-client.ts`: explicit one-client driver and selected database/user readback; no schema setup.
- `packages/db/src/admin-operator-client-owner.ts`: termination/error observation and idempotent all-settled close.
- Tests: `apps/server/src/modules/identity/admin-operator.test.ts`, `packages/db/src/admin-operator-client.test.ts`.
- [Operator runbook](../operations/identity-admin.md).

The CLI accepts only `bootstrap` or `replace`, explicit operator URL/acknowledgement environment, and closed non-TTY JSON stdin capped at4096 UTF-8 bytes. Exact existing IDs and safe reason codes only. Trusted OS/DB access is the authority; the acknowledgement is not authentication. There is no public route, account provisioning, password input, app-DB fallback or automatic migration. A failure after commit may still have committed: inspect state before retrying.

## Previous shutdown-correction verification

Coordinator ran:

```sh
bun --no-env-file test apps/server/src/modules/identity/admin-operator.test.ts packages/db/src/admin-operator-client.test.ts
```

**19 pass, 0 fail, 304 assertions.** Tests use real stream/EventEmitter primitives, the actual lifecycle owner/dispatcher, synthetic inputs and fail-closed subprocesses. They do not open a real Pool, execute SQL or prove actual socket/backend shutdown.

Installed strict no-emit check passed over the six changed TypeScript paths. `git diff --check` passed; staging is empty. LSP unavailable. No build, broad suite, E2E, dependency/lockfile change, migration, Docker, provider, production mutation or accepted auth-proof rerun was performed for this correction.

Review artifacts in this session's temporary storage:

- `/tmp/zetta-rfc004e2-implementation.md`: initial source implementation.
- `/tmp/zetta-rfc004e2-review.md`: initial P1/BLOCK review.
- `/tmp/zetta-rfc004e2-close-fix.md`: regression RED/GREEN and narrow correction.
- `/tmp/zetta-rfc004e2-close-followup-review.md`: final re-review; original P1 resolved, no issues, source-only acceptance supported.

Temporary artifacts may disappear; durable contracts/results belong in the linked task and runbook records.

## Previous bounded verification and resume sequence

The actual command `bash scripts/verify-identity-auth.sh operator` passed six checks: help/configuration/input denials; selected-account bootstrap; repeated/stale/missing-account denial; audit-failure transaction rollback; replacement membership/session scope; and two independent blocked bootstrap commands producing one winner. The dedicated container/network were removed. Full commands, receipt and evidence limits are in [004e3](../../tasks/004e3-verify-existing-account-admin-command.md).

The test-only `identity-proof-client.ts` now reuses the accepted termination-aware ownership helper for all three reserved clients. Its new live use completed. The prior 14-check SQL and five-check auth proofs were not rerun; their historical evidence remains unchanged.

1. Preserve unrelated working-tree changes and use current root/child records. Do not rerun accepted proofs merely to recover context.
2. Review the new 004e3 source/evidence independently for the parent integration gate; coordinator source review and actual runtime results are recorded already.
3. Complete the trusted credential-provisioning contract and effective auth-session revocation proof. Current auth plugins are empty; adding an admin plugin or modifying auth/schema is a separate decision, not an incidental fix.
4. Continue [004f server-owned enrollment status/login](../../tasks/004f-connect-enrollment-status-and-login.md), coordinating the active-member boundary with [RFC-005](../../tasks/005-enforce-actor-and-resource-access-boundaries.md). No public bootstrap or client-derived authority.
5. Finish integrated acceptance before changing root RFC-004 to Done. Production deployment and real accounts remain separate gates.

## Environment and safety

- Repo: the repository root.
- Installed: Bun1.3.14, TypeScript6.0.3, Drizzle1.0.0-rc.4, Better Auth1.7.7, pg8.23.1, pg-pool3.14.0.
- Approved disposable definition: `docker-compose.identity-test.yml`, project `zetta-identity-tests`, PostgreSQL18, `127.0.0.1:55432`, dedicated role/database, tmpfs only. Never substitute root Compose or persistent application storage. See [SQL runbook](../verification/identity-database.md) and [auth runbook](../verification/identity-auth.md).
- `bash scripts/verify-identity-auth.sh` already passed; it provisions and tears down its own disposable service. No need to rerun it for this checkpoint.
- Preserve all tracked/untracked prior work. Nothing staged/committed; no destructive Git cleanup. Do not install dependencies, run broad builds/suites, use paid services or modify production without the applicable authority.
- The latest user instruction resumed work after pi's requested stop. This continuation finished the next bounded CLI/SQL verification slice and refreshed this checkpoint; it did not authorize production changes.

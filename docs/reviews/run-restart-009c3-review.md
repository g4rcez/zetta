# RFC-009c3 independent review

codeQualityStatus: CLEAR
recommendation: APPROVE
blockers: none for the bounded service-process persistence proof

## Findings and source scope

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none.

Reviewed runs-restart.integration.ts, run-readback-proof-client.ts and tests, identity-proof-client.ts alias, fixed launcher mode/tests, task009c3 and worker actual log/status/hash receipts. No product store/schema/contract changes or third database start by this reviewer.

- Child target validation runs before the DB helper import. The helper verifies the dedicated loopback URL/role/database/password shape, shared actual service identity, exact15-table set and parent backend PID's granted40042/2 advisory lock in the correct database/role/application. It reserves one backend and constructs Drizzle only after checks. No child migration, reset or replacement baseline lock exists. The identity helper alias exposes the unchanged existing verifier rather than duplicating it.
- Writer uses a freshly issued005 actor, actual owner store submission and committed synthetic backend transitions with membership→run→attempt locking. Its committed signal follows actual DTO/result/canonical/configuration readback. This synthetic lifecycle setup does not establish dispatcher or native launch authority.
- Parent compares the signal PID with the exact owned Bun child, verifies that child is alive and its named backend exists, sends SIGKILL, awaits exited, checks signalCode and drains output. Backend disappearance is observed before starting the reader. Reader process/backend IDs differ from writer; fresh actor issuance and actual store reads recover exact DTO/result/fingerprint. Four B/admin read denials plus two crossed same-owner run/attempt denials are asserted as not_found. Reader exit0, drained output and backend absence are also asserted.
- Children receive an explicit private environment and fixed executable/source argv, with no inherited application configuration or credentials in argv. IPC is closed and16KiB bounded; stdout is one JSON line and any stderr fails under a1KiB cap. Raw child errors are not forwarded. Sticky forbidden-network guards begin after verified reservation and remain through close, so their scope is post-setup, not an OS firewall.
- Child30second and parent120second timers, bounded database calls and4second backend-disappearance polling bound normal failure handling. Exact owned children are killed/reaped in finally, retained client owners await pool/end-event settlement, and the shell EXIT trap disposes only the dedicated project. Failure cleanup is supported by source and shell fixtures, not claimed as exhaustive actual fault injection. Fixture deletion commits explicitly; no separate zero-count readback is asserted or inferred.

## Evidence and independent checks

Audited ../run-009c3/postgres-run-1.log and postgres-run-1-status.json: worker session98147 exit0, committed writer kill/reap/backendgone, distinct reader recovery and six denials, parent/client close and exact Compose cleanup. No warning appears in the retained transcript. The reviewer did not start another database. Coordinator session54755 was running when assigned; its final result must be attached separately before coordinator acceptance, and is not inferred here.

Reviewer independently reran38 tests /455 assertions across four actual files, strict TypeScript and bash syntax: all exit0. Exact commands/output retained in focused.log, strict.log and shell.log. Independent source-hashes.json matches all six frozen source/test/launcher hashes:

- runs-restart.integration.ts dbafa2bd08948db3bb61f932c12e0e3a686f63778d1b99e11ab8f330896c54f1
- run-readback-proof-client.ts bcb7a737a475e3c9d86a3bd672bc905fb7982c3cbd3edc88f773d9bc38d8ddd9
- run-readback-proof-client.test.ts 801b84dfa25491214bafe240486d12618d340f4be1e8676dbae44e37590b2f3a
- identity-proof-client.ts b38fc310fde6e09c80be0f78a5515ebd30f11a7afa90d5c2ca0e44aab9bdc038
- verify-identity-auth.sh db18390c05702c22e1ab76fdd6ff1cf328963152c4e9454a1eaa8d030d23ae1b
- verify-identity-auth.test.ts df82e3192175883ef002b8fa4a23666fc28272c502943cacbfc7b8409a349e68

## Quality and limits

Code-review, programming and remove-ai-slops perspectives were consulted/applied. Fixed shell behavior, real inert-import/target denials, a positive IPC control plus malformed variants and sticky forbidden-attempt tests are useful boundaries. The actual subprocess proof uses observable PID/backend death and equality assertions rather than trusting a fresh factory or label. No deletion-only, tautological/removal tests or unnecessary production complexity identified.

Approve this actual service-proof-process death/readback criterion. Reader is behaviorally read-only through normal transactions required by FOR UPDATE, not a SQL least-privilege deployment. Controlled sessions are not HTTP sign-in. This does not restart PostgreSQL, the host, a deployed HTTP service or native launcher; synthetic backend facts do not verify native deadline policy, dispatch authority or provider execution. Those broader operational gates remain outstanding.

Evidence directory: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/run-restart-009c3-review`.

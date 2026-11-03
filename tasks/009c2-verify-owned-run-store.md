# RFC-009c2: Actual owned run store proof

Status: accepted bounded actual proof after worker72180 and coordinator74183 each passed15 scenarios/seven observed races with exact cleanup, plus independent CLEAR/APPROVE. Product009c1 and foundations remain frozen. True process restart remains009c3.

Owned proof files are runtime/runs.integration.ts, run-store-proof-cases.ts and run-store-proof-races.ts, plus additive fixed run-store launcher/tests. The accepted run-proof-client remains unchanged. It applies pinned reviewed migrations to the verified fresh15-table baseline and returns three independent reserved clients. No new connection or process is added. The entry validates the strict disposable target before helper import; whole120s deadline includes setup/imports/close. Sticky forbidden network guards start after reserved setup/migrations, increment before throwing and remain installed through cleanup. No claim covers earlier setup instrumentation.

Actors are issued sequentially through createIdentityAccess with a controlled SessionSource and actual seeded user/membership/admin lookup. This is service/database authorization proof, not HTTP/sign-in proof. No simultaneous queries share one PoolClient. The fixture uses actual supported owner methods; backend claim/admission/completion observations are synthetic and go through the separate trusted applyRunTransition inside actual transactions after fresh membership→run→attempt locks. This establishes persistence behavior, not launcher authority, lease dispatch or retry authorization.

## Planned live scenarios

1. Same key for A/B creates independent identities; exact canonical replay returns current DTO after queued cancellation, with one attempt per run. Omitted model/resume normalize exactly to null. Queued result is result_pending; terminal cancelled/no_effect has null result.
2. Every supported semantic mutation conflicts: origin, bot/conversation/configuration ID/version, prompt normalization/whitespace, model and all5budgets. Unsupported harness/connections/resume and extra/type-invalid inputs cannot enqueue.
3. B/admin cannot read/cancel/result A's content; submit cannot accept an injected owner field. Their own ordinary submissions remain permitted. Forged actor and removed membership deny all4methods including replay.
4. Stale CAS denies queued/running cancel; running result is pending, cancellation retains uncertain effects until trusted completion settles cancelled while stop remains unconfirmed.
5. Current/historical result retrieval binds same-owner run+attempt as well as cross-owner substitutions, honors original maxEvents, retains original terminal time and survives fresh factory. A synthetic generation2 fixture tests historical reads only; no retry API exists.
6. Fresh factory preserves queued state and exact private snapshot; synthetically inconsistent cross-row lifecycle is storage_unavailable. This is explicitly not process restart.
7. A narrow temporary attempt-insert trigger forces real transaction failure, leaving no inserted run/attempt. Trigger/function removed before following cases.
8. Wrapper waits for real transaction commit, then throws a synthetic lost acknowledgement. Independent readback proves persistence before same-key repair on second client; no extra attempt. This is a post-commit exception boundary, not a real TCP drop.
9. Duplicate same-key submissions serialize behind observed membership locks and commit exactly one run/attempt.
   10–11. Cancel-first and completion-first use a narrowly scoped update-trigger advisory barrier. Owner observes actual pg_blocking_pids before release. Completion-first retains terminal outcome; cancel-first settles cancelled with actual effects and one terminal timestamp.
   12–13. Identical/conflicting competing completions wait, retaining first terminal outcome/timestamp; stale generation/lease tokens deny. Backend helper re-reads revision under locks to consume committed owner intent.
   14–15. Removal waits behind earlier cancellation then denies repair/read; earlier committed removal denies waiting cancellation without changing status/revision/intent.

Races use first/second clients, observed by owner with a1500ms finite query loop and inherited bounded lock/query timeouts. Pending promises settle after barrier release before trigger removal and close. Each scenario emits only a fixed PASS label; errors emit fixed phase only, no private rows/SQL/cause. Fixtures are removed with explicit ordered deletes, not legacy eight-table cleanup. Launcher checks exact owned fresh tmpfs container, local existing PG18 image, loopback and health, then removes only that container/network; no volume deletion/prune.

## Preparation evidence and next gate

Evidence: `local evidence`.

`red-launcher.log` retains failing fixed-mode/inert-entry tests before implementation. `focused.log` exits0 with35tests/301assertions; `strict.log` exact TS6 strict command exits0; `shell.log` bash syntax exits0. These tests prove shell dispatch/guards and accepted offline row/store behavior, not PostgreSQL transactions. `source-sha256.txt` pins the prepared proof/launcher sources. LSP query outputs are recorded separately; Biome hooks unavailable, no install.

Prospective command after coordinator go and source freeze: `bash scripts/verify-identity-auth.sh run-store`, with approved Docker escalation only for the existing dedicated zetta-identity-tests tmpfs project. No competing project, source edits while running, providers, servers, dependency/environment or Git changes.

Coordinator explicitly deferred true fresh-process service readback to009c3 with a separately reviewed read-only client extension. The parent009 restart criterion remains unchecked; fresh-factory results here must never be described as process restart. Actual store proof and independent repeat/review are still required before acceptance.

## Actual worker result

After source inspection and final35tests/301assertions, strict/shell checks and hashfreeze, coordinator authorized one actual run. `bash scripts/verify-identity-auth.sh run-store` in exec session72180 exited0 on its first attempt. `postgres-run-1.log` records all15 PASS scenarios, all7 observed races, committed fixture removal, reserved clients closed, sticky new-network counter0 and exact dedicated Compose container/network cleanup. No warning, schema/product change or oracle correction occurred. `postgres-run-1-status.json` records tool exit and verified unchanged source hashes. Sources remain frozen for independent coordinator repeat. True process-restart readback remains009c3; no launcher/dispatch/production authorization claim is added.

# RFC-009c2 independent review

codeQualityStatus: CLEAR
recommendation: APPROVE
blockers: none for the bounded actual owned-store proof

## Scope and findings

Reviewed the three run-store proof modules, fixed launcher mode and behavioral tests, target and migration/client adapters, task009c2, worker actual log/status/hash receipts and coordinator session74183 receipt. Production runs.ts and run-rows.ts retain the previously reviewed009c1 hashes. No product edits or additional database starts were performed by this reviewer.

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none.

The proof meaningfully supports its bounded claims:

- Target validation precedes dynamic database import; accepted adapters reject ambient selectors, verify each reserved backend/service, pin migration files and require an empty dedicated target. Three independently reserved clients preserve backend identity. Sticky forbidden-network counters cover the post-setup phase through client close, not setup/migration network activity.
- Controlled SessionSource issues actual ActiveActor identities against real membership lookup. Owner/admin/foreign identity, forged copies and removed membership are checked through service methods. Canonical semantic conflicts, same-key independent owners, exact replay, pending results, same-owner wrong attempt, cross-owner results and historical original-budget validation have observable SQL/service assertions.
- Attempt-insert trigger failure checks actual transaction rollback by unchanged counts. The commit wrapper awaits a real commit before throwing; independent readback and second-client replay prove repair without another attempt. This does not simulate a TCP drop.
- runs.integration.ts:74–85 performs the trusted test consumer's fresh membership→run→attempt locks and re-reads revision before applyRunTransition. Consequently the completion races prove serialized intent consumption and terminal replay, not a dispatcher authorizer. Cancellation uses caller CAS; explicit generation/lease substitutions are denied.
- runs.integration.ts:100–109 observes actual pg_blocking_pids, lock state and expected query before barrier release. run-store-proof-races.ts:15–88 verifies duplicate submit, both cancel/completion orders, duplicate/conflicting completion and both membership-removal orders, with final counts/revisions/status/timestamp/readback. Promises are settled before dropping normal-path gates. Bounded query/lock/session timeouts and the120s process deadline bound failures; finally closes reserved clients and the shell EXIT trap tears down the dedicated tmpfs service. Cleanup failure is nonzero, not success. No claim of exhaustive live cleanup-fault injection.
- Fixture cleanup readback, client close and exact Compose cleanup appear in the worker actual transcript. The coordinator independently records the same15 scenarios/seven observed races, exit0 and no warnings. No assertion relies only on a PASS label: the labels follow awaited service work, SQL assertions and sticky health checks.

## Independent validation

Reviewer reran35 tests with301 assertions, zero failures, strict TypeScript (including proof modules and launcher tests), and bash syntax: all exit0. Exact commands/output are retained alongside this report in focused.log, strict.log and shell.log. source-hashes.json independently matches all five worker-frozen proof/launcher hashes and records unchanged production store/rows hashes.

Worker actual receipt: ../run-009c2/postgres-run-1.log and postgres-run-1-status.json (session72180, exit0). Coordinator actual receipt: ../coordinator-run-009c2.md (session74183, exit0). This review audited those actual receipts and source; it did not start a third database.

## Skill perspective and boundaries

The code-review, programming and remove-ai-slops perspectives were consulted/applied. The new tests drive actual shell dispatch/denial/cleanup and inert-import behavior; actual database assertions exercise behavior and durable readback rather than mirroring implementation constants. No deletion-only or requested-removal tests, unsafe production escape hatch, unnecessary production parsing or needless abstraction was introduced in this slice. Existing shell metadata/source checks are ancillary, not the database oracle.

Approval covers the owned store's actual disposable PostgreSQL persistence/authorization/race proof. Controlled sessions are not HTTP/sign-in proof; synthetic claimed/admitted/completed facts are not native launcher or worker authority; new factory is not fresh-process restart. RFC009c3 fresh-process readback, RFC010 claim/grant/worker integration and real native/provider/systemd execution remain separate required gates. No production deployment or parent009 completion is implied.

Evidence directory: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/run-store-009c2-review`.

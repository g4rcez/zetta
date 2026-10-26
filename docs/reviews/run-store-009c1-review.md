# RFC-009c1 independent owned-store review

codeQualityStatus: CLEAR
recommendation: APPROVE for scoped offline source acceptance
blockers: []
Reviewed2026-10-22. Actual database races/persistence/provenance remain mandatory009c2 gates; this does not complete parent009.

## Findings by severity

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none.

## Ownership and transaction audit

Read complete runs.ts,run-rows.ts,both tests,009c1 task/evidence,accepted durable-runs/ownership ADRs and actual identity/access provenance implementation.

runs.ts:53-68 validates issued ActiveActor through requireOwned's WeakSet before entering the transaction; structurally copied/admin actors have no bypass. The captured owner is a primitive string. Every owner operation, including reads, existing-submit replay and terminal cancellation, selects current membership FOR UPDATE and denies missing/inactive status before domain queries. Fresh per-request session issuance remains the caller contract; store additionally performs current membership verification.

Run predicates always include owner plus ID/request key; attempt predicates include owner plus run and generation/attempt ID. loadCurrent locks run before current attempt. Historical result lookup first validates current run/current attempt, then locks the requested owner/run/attempt. This is compatible with the declared membership→run→attempt order. No external IO spans these transactions.

The four frozen owner methods expose no backend completion operation. applyRunTransition is a separate trusted transaction primitive: its caller already possesses database authority and must hold fresh membership plus any earlier sorted connection locks, own commit/rollback and obtain trustworthy backend facts. It re-reads/locks current owned rows before invoking the closed state transition. Its existence is not an HTTP or owner-authority bypass under that explicit boundary.

## Mutation and row audit

Submission uses strict frozen parsed input and exact canonical bytes. The prior path locks owner/request key, validates stored canonical input and full current rows before returning a DTO, and rejects changed semantics. A new path reads DB millisecond time after membership lock, generates both UUIDs and inserts run plus generation1 attempt in the same transaction. Unique-conflict fallback re-reads owner/key; it cannot invent an additional attempt to repair a replay.

persist uses accepted transitionRun CAS/identity/time/cancel precedence, then writes only the explicit lifecycle projections. Run update predicates include owner,ID,prior revision and current generation; attempt update includes owner,run,attempt ID,generation. Missing update rows fail; caller transaction rollback must prevent a partial projection. No-op terminal replay returns original parsed DTO. No immutable input/owner/config/request key/current-generation field is included in updates.

The actual-row readers validate Date instances before epoch conversion, complete strict column shapes, canonical snapshot correspondence with immutable columns, owner/run/generation linkage and current run/attempt projection equality. Full current state passes parseRunState before safe DTO projection, retaining009b2a cancellation/result guards. Partial/oversize/malformed result columns reject; sequence is bounded by immutable stored input maxEvents.

Historical attempts validate their own lease/start/finish/stop/result/cancellation-reason facts and stored input budget without borrowing current cancellation time. Current and historical result IDs remain owner/run scoped. Valid queued/running results return result_pending; invalid rows do not masquerade as pending. Safe DTO/result envelopes omit owner,lease,request key,snapshot and SQL details.

Unexpected mutation transaction rejection is fixed outcome_unknown; read rejection is storage_unavailable. Known access/boundary/store errors remain their closed types. No raw driver cause or SQL/input string is attached. applyRunTransition itself leaves transaction/error orchestration to its trusted caller;009c2/010 must use that contract rather than exposing it directly.

## Independently repeated checks

All exit0:
- bun --no-env-file test apps/server/src/modules/runtime/runs.test.ts apps/server/src/modules/runtime/run-rows.test.ts apps/server/src/modules/runtime/run-contract.test.ts apps/server/src/modules/runtime/run-state.test.ts: **42 pass,0 fail,273 assertions**.
- Exact strict command in run-009c1/strict-final.log (strict,exactOptionalPropertyTypes,noUncheckedIndexedAccess,noUnused,noFallthrough,verbatimModuleSyntax): zero diagnostics.
- SHA256 recomputation matches all four frozen entries below.

Writer LSP receipts were reported/inspected through evidence, not independently rerun. No actual database was started or queried by this reviewer. Tests' lazy SQL handle compiles statements only and closes its pool; inert-import subprocess guards connection entry points.

## Test quality / skills

Applied previously loaded programming/TypeScript,remove-ai-slops and code-review-and-quality perspectives. Boundary tests establish pre-transaction syntax/provenance denial and fixed outer failure classification; they deliberately do not simulate an ORM. Actual-row tests cover corrupt linkage/canonical/date/state/result fields, allowed lifecycle projections,pending positives and historical facts. SQL compilation verifies parameter binding and allowed columns, not actual store transaction execution. Foundation tests retain the meaningful pure state/canonical oracle coverage.

No deletion/prose assertion, unsafe type escape, generic repository layer or needless normalization warrants a finding. Historical validation has a concrete responsibility distinct from current merged-state validation. The absence of a fake transaction test is appropriate; the remaining confidence must come from009c2.

## Required009c2 proof

Use the separately approved dedicated PostgreSQL proof, not a competing service:
- Issued A/B/admin/forged/removed identities; fresh membership lock behavior for every method and replay, including removal ordering.
- Same-owner/key identical and conflicting submit; another-owner independent key; concurrent duplicate submit produces exactly one run/attempt; exact canonical immutable snapshot readback.
- Real deferred constraints and atomic rollback of run+attempt insert/update failures; owner/current-generation/revision predicates.
- Pending/current/historical result reads with bounded private output and corrupt-row rejection.
- Queued cancel, both cancel/completion orders and cancellation-before-loss; stale attempt/generation/lease/revision denial and normalized terminal replay.
- Post-real-commit acknowledgment failure followed by identical-key/read reconciliation without duplicate attempts; fresh-factory durable readback, accurately distinguished from full process restart.
- Actual transition helper used inside the caller's fresh membership transaction, with independent reserved clients and observed lock barriers. No production claim/dispatch loop or provider execution is established by synthetic backend facts.

Public producer resource/readiness authorization, actual backend fact provenance,010 claim/lease/grant capacity/reconciliation and native integration remain downstream gates.

## Source identity

- runs.ts: dfa9c25404e7d1779b6b3b30e9fde561420fd2afa38a917ab43a82307b3f0c87
- run-rows.ts: 983ff7103d5ad6b93ffea3c68fc915a46475dd3546be2055ecc9e865d8c61b1a
- runs.test.ts: 44b5329bf2f26f40f1af257e6bbb7282def95143a054489e949bff957f019bd3
- run-rows.test.ts: 6a5cee88874c8898fd41716e6a6d454dec61dff3b21c8b1a975989eb10cf1591

Evidence root: .omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/run-009c1/. Review made no product/schema/launcher/environment/Git edits.


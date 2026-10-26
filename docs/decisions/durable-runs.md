# Durable runs and attempts

Status: accepted bounded foundation after [independent CLEAR/APPROVE review](../verification/reviews/durable-runs-009a-review.md), 2026-10-22. RFC-009 remains incomplete. Separate009b1 schema and009b2 pure-contract children are authorized; this design itself delivers no schema, submission route, dispatcher or execution proof.

## Existing contracts and scope

[RFC-006](../../apps/server/src/modules/runtime/harness.ts) already requires actor/run/attempt/bot/conversation/configuration IDs, bounded input, owner-tagged opaque connection/session references and terminal outcomes including `uncertain`. Its parser checks shape, not authorization. [Ownership](ownership.md) supplies immutable initiating identity and no administrator content bypass. [Connection storage](connection-secrets.md) supplies pinned credential versions and fresh authorization, with grants owned by RFC-010. [The supervisor](runtime-supervisor.md) requires immutable attempt lease/fence identity and treats unknown activation, input delivery and cleanup conservatively.

Use PostgreSQL as the only work queue. RFC-009 stores requested work and transitions; RFC-010 owns claim scheduling, capacity, leases, dispatch grants, cancellation delivery and reconciliation. RFC-011 owns replay events; RFC-025 owns conversation integration. None requires an events/queue/repository platform in RFC-009.

## Proposed records

Two tables, with explicit columns and closed checked values; JSON is limited to validated versioned snapshots/result content. All IDs generated here are server `crypto.randomUUID()` values, compatible with RFC-006. Existing actor/resource IDs must satisfy its exact 1–128 ASCII identifier contract; reject incompatibility rather than truncate or invent an identity mapping.

| Record | Immutable identity/input | Mutable lifecycle |
| --- | --- | --- |
| `runs` | UUID `id`; `ownerUserId` FK to membership; `requestKey` canonical UUID; `originKind` interactive/setup; `botId`, `conversationId`, `configurationId`, positive safe `configurationVersion`; `inputVersion=1`; private canonical `inputSnapshot`; `createdAt` | positive integer `revision`; `status`; positive integer `currentGeneration`; `cancelRequestedAt`, `startedAt`, `finishedAt` nullable timestamps |
| `run_attempts` | UUID `id`; `runId`, `ownerUserId`; positive integer `generation`; `createdAt` | `status`; `effectState`; nullable `leaseId`, `leaseExpiresAt`, `claimedAt`, `startedAt`, `finishedAt`, `stopConfirmedAt`; bounded private terminal `result`; cancellation reason; RFC-010's later reconciliation evidence |

`runs` unique `(ownerUserId,requestKey)` and `(id,ownerUserId)`. Attempts unique `(runId,generation)` and `(id,runId,ownerUserId)`, with restrictive composite `(runId,ownerUserId)` FK. Owner/origin/config/input/request key never update. Enforce immutability with narrowly generated SQL triggers as well as service update allowlists; table checks alone cannot compare OLD/NEW. Attempt identity never updates; lease identity becomes immutable once assigned. No delete cascades. Positive revisions/generations bounded to PostgreSQL integer range; exhaustion fails closed.

Initial submission inserts run and generation-1 queued attempt in one transaction. Resolve the current attempt by `(runId,currentGeneration)`, avoiding a circular current-attempt FK. Every transition locks the run before its attempt and verifies that tuple. The generated migration must enforce existence of the current generation with deferred constraint triggers covering both run insert/current-generation updates and attempt deletion/identity updates. Re-read the current run/generation inside the deferred function at commit; do not put the existence lookup in an immediately evaluated WHEN condition. Thus changing/deleting the current attempt cannot bypass the check by leaving the run row untouched. Schema review and actual concurrent pointer/delete tests must verify this PostgreSQL-specific mechanism before acceptance; do not assume a Drizzle declarative API for triggers. [PostgreSQL18 trigger contract](https://www.postgresql.org/docs/18/sql-createtrigger.html) requires deferrable constraint triggers to be AFTER ROW and evaluates WHEN immediately. Custom trigger SQL needs a separately reviewed feature migration; offline generation alone is insufficient proof.

Run and attempt status both use exactly `queued | running | succeeded | failed | cancelled | interrupted`. Attempt `effectState` is separately `no_effect | known | uncertain`: `no_effect` requires authoritative evidence that execution/effects never began, `known` means a complete validated outcome (which may include effects), `uncertain` means effects cannot be determined. Queued starts `no_effect`; crossing dispatch admission conservatively changes it to `uncertain`; only trusted completion/reconciliation can settle it. RFC-006 `uncertain` maps to `interrupted` + `uncertain`, never ordinary failure. Terminal logical status is not proof of stopped resources: `stopConfirmedAt=null` retains capacity and quarantine under RFC-010 even if `finishedAt` is set.

Initial cancellationReason is nullable or server-derived `owner_requested` only; other010 stop reasons require their own closed extension. Terminal result columns are all-null or the closed version1 shape; queued cancellation/uncertain interruption may have no result. Running requires leaseId/leaseExpiresAt/claimedAt, with finishedAt/result null. It may record stopConfirmedAt before logical settlement: this independent resource fact closes admission and does not assert success, clear effect uncertainty or authorize retry.010 capacity must count every running lease plus unconfirmed terminal resources; a running stop fact alone releases no claim. Queued has no lease/claim/start/finish/stop/result/cancellation facts. Terminal requires finishedAt; lease identity is entirely absent for preclaim cancellation or present as the complete triple. Timestamp ordering follows created/claimed/started facts where present, with millisecond precision.

`leaseId` is generated once at claim; `generation` is the launcher fence, increasing only for a new attempt. Lease expiry never authorizes reactivation of an existing attempt or replacement of an unresolved one. RFC-010 may extend the same lease after fresh authorization and confirmed ownership; cannot replace its identity. No launcher receipt, process handle or lease is exposed in owner DTOs.

## Strict service contract and durable input

Proposed trusted service methods, not HTTP endpoints. All objects reject additional fields. Dates in request/DTO are finite valid safe-integer UTC epoch milliseconds. Database timestamps use timezone-aware columns and database time, with millisecond precision. Missing optional snapshot values become null exactly once; Unicode is preserved without trimming/normalization; malformed Unicode and NUL in text are rejected for PostgreSQL compatibility.

```ts
type SubmitRequest = Readonly<{
  requestKey: string; // canonical UUID, stable across acknowledgement loss
  origin: "interactive" | "setup";
  botId: string; conversationId: string;
  configurationId: string; configurationVersion: number;
  input: Readonly<{
    prompt: string;
    harness: "fixture" | "pi" | "codex" | "omp" | "claude-code" | "opencode" | "cursor";
    model: string | null;
    budgets: RunInput["budgets"];
    connections: readonly Readonly<{ reference: string; credentialVersion: number }>[];
    resumeReference: string | null;
  }>;
}>;
type RunDto = Readonly<{
  id: string; revision: number; origin: "interactive" | "setup";
  botId: string; conversationId: string; configurationId: string; configurationVersion: number;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  attemptId: string; generation: number; effectState: "no_effect" | "known" | "uncertain";
  createdAtMs: number; startedAtMs: number | null; finishedAtMs: number | null;
  cancelRequestedAtMs: number | null;
}>;
submit(actor: ActiveActor, request: SubmitRequest): Promise<RunDto>;
getOwned(actor: ActiveActor, request: { runId: string }): Promise<RunDto>;
cancelOwned(actor: ActiveActor, request: { runId: string; expectedRevision: number }): Promise<RunDto>;
```

The initial implementation accepts only `harness="fixture"`, empty connections and null resume. The shape reserves only already defined RFC-006 concepts; unsupported native selections/references fail `unsupported` and cannot enqueue executable native work. Origin routine/delegation/workflow/hook is deliberately not accepted until its producer has trusted owner derivation and a separately reviewed discriminated origin snapshot; no arbitrary source-ID JSON or impersonation flag.

Persist a canonical, fixed-position version-1 JSON encoding of every semantic field above, including ordered connection entries, all budgets, model/resume nulls, origin and configuration identity/version. Reject duplicate connection references. Prompt is at most 65,536 UTF-8 bytes and within RFC-006's string bound; total snapshot at most 96 KiB UTF-8; connections at most32, versions positive integers. The snapshot includes the complete assembled prompt/context needed to reconstruct input, not merely a mutable conversation pointer. No later read of current bot instructions silently changes it. Current configuration fields needed beyond this finite envelope require a versioned design extension, not an unvalidated config blob.

Snapshot is private application data, never logged or returned in RunDto. No credential bytes, connection envelopes, native profile files, URLs carrying tokens, process environment or secret-entry observations belong in it. This is a trusted producer boundary, not a claim that arbitrary user text can be automatically scrubbed of every secret. Future public input must establish its private-content policy. At dispatch derive RFC-006 owner tags/context from stored owner and generated attempt, resolve each connection through owner bindings and the pinned credentialVersion, and reauthorize. An opaque reference is neither a bearer capability nor authority to select the latest key. No secret resolver is introduced by009.

Bot/conversation/configuration producers do not exist yet. Store validated opaque references without FKs to nonexistent tables; neither this validation nor an issued actor proves those resources exist or are usable. Only a trusted fixture producer may call the initial service. Before public submit, RFC-020/025 must prove bot visibility/use, private conversation ownership, immutable version existence, configuration provenance/readiness and owner-bound connection resolution in actual queries, including substitutions by B/admin. Later migrations add appropriate FKs where valid; shared-bot use must not incorrectly require bot ownership. A stored reference cannot bypass these mandatory producer/dispatch checks. Scheduled identity issuance is separately blocked; never cast a structural object to ActiveActor.

## Transactions, idempotency and cancellation

Every owner method first validates syntax, calls `requireOwned(actor,{ownerUserId:actor.userId})` to verify issued provenance, then locks and rechecks active membership inside its transaction. Query runs by owner+ID/key, including admin. Removed membership denies reads and replay. Unknown/foreign resources share `not_found` without metadata. Read DTOs/results must be allowlist-parsed from actual stored rows; corrupt rows return fixed `storage_unavailable` without input/SQL/cause leakage.

Submission canonical equality is exact UTF-8 byte equality against the stored private snapshot, not just a digest. Same owner/key and identical snapshot returns the existing run's current DTO without a second attempt; changed semantic payload returns `request_conflict`. Syntax and membership checks precede replay; current readiness/config freshness checks apply only to a genuinely new submission and later dispatch. Key reuse by another owner is independent and reveals nothing. Unique constraint plus locked membership serializes same-owner submissions; insert conflict handling rereads the owner-scoped row. Never include generated IDs or current time in the semantic comparison. No extra MAC/encryption configuration is needed for deduplication.

Owner operations lock membership → run → current attempt. Future credential dispatch uses membership → sorted connection rows → run → attempt → grant; this preserves007's connection-before-grant order. Never take a connection lock after a run lock. Revocation may update grants without taking run locks, then the worker consumes cancellation; any later direct run update must use this same order. A future capacity gate may precede membership only if all paths needing it follow gate → membership and none acquire gate while holding membership; RFC-010 must prove this complete order with removal/revoke. No locks span launcher/network/harness calls.

| Input state / event | Transactional result |
| --- | --- |
| queued / claim | RFC-010 only: fresh authorization and capacity reservation; set run/attempt running, claim lease identity/deadline, increment run revision. `startedAt` waits for validated execution admission, not claim. |
| queued / owner cancel | CAS expected revision; run/attempt cancelled, terminal timestamps, no_effect. No launcher contact or lease exists. |
| running / owner cancel | CAS revision; durable cancelRequestedAt and reason, increment revision. Worker closes admission and stops exact resources. Intent alone is not a stopped/success response. |
| running / validated completion | CAS current attempt+generation+lease identity and run revision. Without earlier cancellation intent, commit succeeded/failed and validated effect state/result; with intent, settle cancelled with actual effect uncertainty retained. |
| running / crash, lost protocol or expiry | Without committed cancellation intent, RFC-010 records interrupted/uncertain. If cancelRequestedAt committed first, settle cancelled/uncertain instead. Set logical finishedAt while retaining unresolved stop/cleanup independently. This follows the same run-row linearization as validated completion and never rewrites an earlier terminal outcome. No inference from exit0 or missing output. |
| terminal / duplicate fact or cancel | Matching terminal fact is idempotent; conflicting completion is `transition_conflict`. Cancellation returns existing terminal DTO without altering it. Stale nonterminal revision returns `stale_revision`; reread repairs acknowledgement loss. |

Cancellation/finish race linearizes at the run row: completion committed first remains terminal; cancellation intent committed first wins cancellation status when settled. A cancelled result can still report uncertain effects. Worker uses an internal transition function accepting the exact locked attempt identity, expected revision, closed terminal fact, stop proof and bounded result; do not expose a user-settable `noEffects` boolean. Late/stale generations cannot overwrite current status. RFC-010 cleanup/reconciliation may settle stop/effect facts later without rewriting the original terminal outcome/timestamp.

Matching terminal replay compares the normalized stored terminal status/effect/result payload plus attempt/generation/lease/sequence and retains the original finished timestamp. After committed owner cancellation, raw succeeded/failed outcomes with identical complete normalized payload both represent cancelled/known; raw backend outcome is not an additional persisted receipt identity. Different normalized status, effect, result text, error or sequence conflicts. A newly generated receive/DB clock value alone must not make the same fact conflict or rewrite its original finish time. No extra idempotency receipt field is required for this pure transition contract.

No retry API in009. Future explicit retry can append only a new attempt/generation to the same immutable run, reset its current lifecycle projection, and preserve every old attempt/result/timestamp. It requires owner intent plus trusted reconciliation proving old resources stopped and either no effects or resolved effects with an explicit safe next action. An owner clicking retry alone never clears uncertainty. Changed input is a new logical request key/run. No automatic external replay, including after an expired lease or unknown DB commit. Any ambiguous mutation acknowledgement returns fixed `outcome_unknown`; repair by same submit key or owner read, never generate another attempt merely to repair a response.

## Result and future consumers

Private terminal result v1 is `{version:1,text:string,errorCode:null|HarnessErrorCode,lastSequence:number}`; text <=64 KiB UTF-8, sequence safe nonnegative integer bounded by input maxEvents. It is stored on the exact attempt and read only through `getResultOwned(actor,{runId,attemptId}) -> {runId,attemptId,generation,status,effectState,finishedAtMs,result}` after the same authorization. Both IDs must match the owner-scoped composite; no raw tool frames/stderr/URLs/HTML or arbitrary source payload. Text is untrusted content and later rendering must escape it. Error codes are closed006 values; unexpected transport details stay private.

The durable source identity is run+attempt+generation+terminal sequence. RFC-025 must transactionally deduplicate conversation materialization by that identity, then validate its conversation ownership;009 cannot invent a message FK. RFC-011 adds bounded ordered event retention/cursors and fresh replay authorization, separately from this terminal result. Stream disconnect does not resubmit a run. Replay expiry must still allow authorized terminal retrieval. No TTL, prompt deletion or terminal tombstone purge is chosen here:011/025 must settle retention before production, keeping unresolved attempts and idempotency identities through the supported retry/repair horizon.

## Implementation slices and proof gates

1. **009b schema and transition contract:** at most five product files: `packages/db/src/schema/runs.ts`, schema index, `apps/server/src/modules/runtime/run-contract.ts`, `run-state.ts`, and existing DB query exports only if needed. Focused contract/state/schema tests plus single-writer generated feature migration and its reviewed trigger SQL. Prove state table offline now; later approved PG checks establish uniqueness, immutable fields, composite ownership, current-attempt existence and timestamp constraints. No worker.
2. **009c owned store:** `runs.ts`, optional `run-input.ts` for canonical snapshot responsibility, `runs.test.ts`, and bounded dedicated DB proof script/test plus proof-client extension if needed (maximum five files). Implement fixture-only submit/read/result/cancel, no claim loop or grants. Prove issued-actor/removed-member/admin denials, exact request conflicts, immutable snapshot after restart and actual concurrent completion/cancel under approved disposable PG. A fake ORM is not transaction proof.
3. **009d integration acceptance:** only focused durable-run DB proof test/script and evidence/task records, maximum five files; accepted migrations applied to disposable DB, independent connections, injected acknowledgement loss, restart reads and constraint negatives. No production composition, launcher or native claim. Root accepts009 only after actual criteria pass;010 separately adds its claim/lease/grant integration and multiworker fixture proof.

Installed primary source verified: Drizzle ORM `1.0.0-rc.4`; `pg-core/query-builders/select.d.ts` exposes `.for(strength,config)`, `select.types.d.ts` permits `{skipLocked:true}` mutually exclusive with `noWait`, and `pg-core/session.d.ts` accepts `isolationLevel:"read committed"`. Existing connection store already uses transaction/row locks. These API facts support a proposed010 claim query, not proof of correct capacity: serialize a DB capacity gate, count all leased/unconfirmed attempts (including terminal quarantines), then claim eligible queued rows with `FOR UPDATE SKIP LOCKED` under the approved global order. No010 code or capacity schema is added now.

Coordinator accepts the fixture-only producer boundary,96KiB snapshot/64KiB terminal limits, canonical equality, two-table current-generation trigger and cancellation-intent precedence after independent review. Concrete storage clarification: canonical input is bounded UTF-8 text, preserving its exact encoding; configurationVersion, revisions, generations and sequence counters use signed32-bit positive/nonnegative bounds as appropriate. Store the closed terminal-result fields in typed nullable columns rather than unbounded arbitrary JSON; decode to the specified result object at the service boundary. These choices add no queue or caller authority. Operational blockers remain: actual009 constraints/races;010 worker authorization, global lock order and recovery;020/025 producer/readiness and source linkage;011/025 retention; native/launcher proof. Design review does not resolve these by assumption.

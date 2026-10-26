# Fixture dispatch storage

Status: storage design accepted by coordinator after independent CLEAR review,2026-10-22. No schema, migration, trigger, dispatcher or database proof is implemented by this document. Parent010 remains incomplete. Review: [010c1](../reviews/dispatch-storage-010c1-review.md); reviewed content hash is recorded there, with only this acceptance status added afterward.

Parents: accepted [durable dispatch](durable-dispatch.md), [010b1 pure contract](../../tasks/010b1-define-dispatch-action-contract.md) and existing [durable runs](durable-runs.md). Next gate: [010c1 task](../../tasks/010c1-design-dispatch-storage.md).

## Decision and inspected integration points

Add exactly three tables: dispatch_capacity, dispatch_claims and dispatch_grants. Runs/run_attempts remain the only runnable-work source. Claims record occupancy/resource ownership; grants record spent action admission. No second lease, queue, scheduler or credential engine is introduced. Initial records support fixture activate/input only, with null credential bindings. A schema alone grants no execution authority.

Direct source inspection found:

| Existing export/path | Actual relevant storage contract |
| --- | --- |
| runs in packages/db/src/schema/runs.ts | UUID id; owner_user_id references membership.user_id; unique(id,owner_user_id); current_generation, run revision, canonical private input_snapshot, status and terminal/cancel timestamps. |
| runAttempts in the same file | UUID id; unique(id,run_id,owner_user_id); unique(run_id,generation); immutable generation/lease identity, nullable lease_expires_at and claimed_at; status/effect/stop/terminal facts; cancellation_reason permits owner_requested only. |
| connection in packages/db/src/schema/connections.ts | UUID id, text owner_user_id references auth user; unique(id,owner_user_id,kind), kind=api-key. |
| connectionCredential in the same file | PK(connection_id,credential_version); owner/kind FK to connection(id,owner_user_id,kind). No unique(connection_id,credential_version,owner_user_id) exists. |
| packages/db/src/schema/index.ts and packages/db/src/relations.ts | Barrel exports auth/identity/connections/runs; defineRelations consumes the barrel. Add only the new dispatch export; no existing relation rewrite is needed. |
| apps/server/src/modules/runtime/runs.ts | Owned store locks membership then run then current attempt. applyRunTransition is a trusted transaction primitive, not authority; run revision is the existing run/attempt lifecycle CAS. |
| packages/db/run-test-migrations/20261022180711_runs_constraints/migration.sql | Existing immutable run/attempt identity and lease guards; attempt update/delete locks its run; deferred current-generation existence checks lock run then attempt. These must remain in the integrated lock audit. |

The DB package exposes schema subpaths through its wildcard exports. Do not invent a run-store.ts or an owner-triple credential key. Schema code must import actual runs/runAttempts exports and preserve current run/connection migrations.

## Common SQL representation

Use PostgreSQL uuid for server-generated run/attempt/lease/action/operation/receipt IDs, integer for positive counters1..2147483647, text for closed enums and bounded canonical ASCII identifiers, and timestamptz(3) for UTC millisecond instants. SQL UUID input normalization is not public request validation: the service still rejects noncanonical UUID strings using accepted parsers. All required columns below are NOT NULL; only explicitly nullable columns accept NULL.

Identifier checks reuse C-collated ^[a-zA-Z0-9_-]{1,128}$ for owner, installation and policy. Digests use ^[a-f0-9]{64}$; image identity uses ^sha256:[a-f0-9]{64}$. Require isfinite(timestamp) and extracted epoch milliseconds between -8640000000000000 and8640000000000000, matching JavaScript Date/runEpochSchema bounds; reject infinity/-infinity and invalid chronology. Do not use transaction-time CHECK expressions that change meaning as time passes. Fresh deadline admission belongs to locked service operations using DB time.

All FKs below use ON UPDATE RESTRICT, ON DELETE RESTRICT. No cascades, deferrable action admissions, automatic timestamps, random-ID defaults or lazy singleton creation. Constraint names are fixed, feature-prefixed and reported in proof oracles; raw database messages never reach owner APIs.

## dispatch_capacity

| Column | Type / invariant |
| --- | --- |
| id | integer PK, CHECK id=1 |
| launcher_installation_id | bounded text; one selected installation for this initial deployment |
| policy_version | bounded text, exact trusted operator fixture policy |
| global_limit / actor_limit | integer, CHECK global_limit=2 AND actor_limit=1 |
| created_at | finite timestamptz(3), immutable installation bootstrap time |

Add UNIQUE(launcher_installation_id,policy_version), referenced by claims. The singleton is a mutex/policy row, never a counter. An explicit operator bootstrap transaction inserts the exact reviewed installation/policy after migrations; schema generation does not insert environment-specific values. Repeated bootstrap reads and compares exact existing values, never upserts/reconfigures. Missing/mismatched policy denies claims. BEFORE UPDATE/DELETE and BEFORE TRUNCATE guards reject modification; policy change requires a future reviewed maintenance migration with dispatch disabled and unresolved claims reconciled. Fixture proof bootstrap uses synthetic values on its dedicated disposable target.

## dispatch_claims

| Column | Type / invariant |
| --- | --- |
| attempt_id | UUID PK; one reservation per attempt forever |
| run_id / owner_user_id | UUID / bounded text; composite identity FK below |
| generation / lease_id | positive int32 / UUID, immutable copies of the already-assigned attempt identity |
| claim_operation_id | UUID UNIQUE, generated before reservation transaction for acknowledgement-loss lookup |
| launcher_installation_id / policy_version | bounded text, immutable; composite FK to dispatch_capacity |
| launch_spec_version | integer CHECK=1 |
| launch_spec_canonical | text, octet_length1..16384, IS JSON ARRAY; complete secret-free spec tuple below |
| launch_spec_digest / launch_identity_digest | lowercase SHA256 text, immutable consistency aids |
| image_digest | exact trusted sha256 image identity, immutable; no caller-selected image |
| deadline_at | immutable finite timestamptz(3), created_at < deadline_at <= created_at+60seconds |
| receipt_id | nullable UUID; binds NULL→one receipt once, never clears/replaces |
| prepare_intent_at | nullable finite timestamp; binds once before first prepare submission |
| resource_state | text: not_submitted, prepare_pending, prepared, active, stopping, unknown, cleaned |
| pending_operation_id / pending_operation_kind | paired nullable UUID / enum prepare,activate,input,stop,remove; one unresolved resource operation at a time |
| cleanup_kind / cleanup_confirmed_at | paired nullable enum not_submitted,removed / finite timestamp; authoritative fact recorded once |
| cancel_reason / cancel_requested_at | paired nullable closed reason owner,deadline,revocation,shutdown,recovery / finite timestamp; first intent is sticky |
| released_at | nullable finite timestamp, set once; never clears or changes |
| revision / created_at / updated_at | positive int32 / finite timestamps; insertion revision1 and updated_at=created_at; immutable created_at, monotonic updated_at |

FK(attempt_id,run_id,owner_user_id) targets the existing run_attempts unique triple. Add UNIQUE(attempt_id,run_id,owner_user_id) on claims for the grants FK, and UNIQUE(launcher_installation_id,receipt_id); ordinary NULL-distinct semantics permit multiple unknown receipts. Add indexes on (launcher_installation_id,owner_user_id) WHERE released_at IS NULL and (launcher_installation_id,attempt_id) WHERE released_at IS NULL. Claim-operation unique lookup is the repair key; it is not an instruction to prepare.

Do not persist another lease-expiry column or logical status. Capacity projection joins the exact attempt (and current run when admitting/releasing) for leaseExpiresAtMs/logicalStatus. It maps cleanup_kind=NULL to unconfirmed and either recorded cleanup kind to confirmed, and passes pending_operation_id through. Generation/lease copies must equal the actual locked attempt; current-generation correspondence is checked against locked runs. Existing lease assignment and claim insertion commit together, using the same DB millisecond instant for attempt.claimed_at and claim.created_at. Renewal changes only run_attempts.lease_expires_at through its existing lifecycle authority and increments claim revision in the same transaction, capped by immutable deadline_at; it cannot replace lease/generation or resurrect expiry. The schema child does not implement renewal.

Row-local checks:

- All nullable fact times are within [created_at,updated_at]; updated_at>=created_at. prepare_intent_at, receipt and cancellation bind once; receipt requires prepare_intent_at. Active/prepared/stopping/cleaned states require a receipt except a not_submitted cleanup remains in not_submitted. A prepare_pending claim has prepare intent and pending kind=prepare, with no receipt yet. Unknown may lack a receipt and retains unresolved operation metadata when present.
- not_submitted requires prepare_intent_at=NULL, receipt_id=NULL and pending pair NULL. Every other resource_state requires prepare_intent_at. A pending pair must be fully null or fully nonnull. activate/input/stop/remove require a receipt; prepare uses its own generated operation ID and may remain pending after a late receipt is bound until settlement is recorded.
- cleanup_kind=not_submitted requires resource_state=not_submitted, no prepare intent, no receipt and no pending operation. cleanup_kind=removed requires resource_state=cleaned, a receipt, prepare intent and no pending operation. cleaned requires removed cleanup. Neither timeout nor an empty inventory sets these fields.
- released_at requires cleanup_kind/cleanup_confirmed_at, no pending operation and released_at>=cleanup_confirmed_at. Release also requires the actual locked logical terminal state, described below; it is not copied into a caller-set claim boolean.
- cancel_reason=deadline additionally requires cancel_requested_at>=deadline_at. All reasons are intent, never proof of stop, cleanup or logical completion.

Minimal added cleanup state resolves the010a omission: two pending-operation columns and two cleanup fact columns. No history/event table or caller-supplied settled/noEffects boolean is added. Clearing a pending pair requires the later service to match the exact stored operation ID/kind and trusted backend outcome; a lost response retains it and marks unknown. Removing a resource may settle resource operations while the grant's external-effect outcome remains uncertain. Those concepts must not be conflated.

## dispatch_grants

| Column | Type / invariant |
| --- | --- |
| id | UUID PK, generated before transaction |
| attempt_id / run_id / owner_user_id | UUID / UUID / bounded text, immutable composite FK to claims |
| action_id / kind / sequence | UUID / activate or input / positive int32; activate sequence=1; input1..65537 |
| canonical_action / action_digest | text octet_length1..16384 IS JSON ARRAY /64 lowercase hex; immutable accepted010b1 encoding and digest |
| connection_id / credential_version | nullable UUID / integer; fixture CHECK requires both NULL |
| expires_at | immutable finite timestamp, created_at < expires_at <= created_at+30seconds; service also requires <= claim.deadline_at |
| state | pending,issued,cancelled,expired,uncertain |
| delivery_outcome | not_attempted,acknowledged,unknown |
| issued_at / cancelled_at | nullable finite timestamps; no invented issue timestamp for unknown commit |
| revision / created_at / updated_at | positive int32 / finite timestamps; initial1 and equality, immutable created_at, monotonic updated_at |

Add UNIQUE(attempt_id,action_id) and UNIQUE(attempt_id,kind,sequence). These retain spent action/sequence tombstones. Index (attempt_id,id) for sorted grant locking. Canonical action carries generation, lease, installation, policy and receipt; do not add redundant grant copies of those columns. The service compares every one with the locked claim/attempt, including the receipt that must already be bound. FK ownership alone cannot detect a substituted canonical payload.

CHECK state/time/delivery combinations mirror parseDispatchGrant exactly: pending has no issued/cancelled time and not_attempted; issued requires issued_at and delivery not_attempted or acknowledged; uncertain requires unknown or acknowledged and may have issued_at=NULL; cancelled requires cancelled_at, no issued_at, not_attempted; expired has no issued/cancelled time, not_attempted and updated_at>=expires_at. issued_at, when present, is in [created_at,expires_at), cancellation is no earlier than issuance, and both are <=updated_at. Expiring a spent grant never turns it into expired/no-effect; accepted transition semantics leave its spent state intact.

Initial INSERT is pending/revision1 with no issue/cancel time and not_attempted. BEFORE UPDATE enforces pending→issued/cancelled/expired/uncertain, issued→issued/uncertain, uncertain→uncertain, and no mutations of cancelled/expired terminal rows except an exact no-op. Delivery can move not_attempted→acknowledged or unknown, and unknown→acknowledged; acknowledged cannot regress. issued_at may bind only on pending→issued and is then immutable. cancelled_at binds once. A matching acknowledgement is a service no-op preserving revision/time. uncertain plus issued_at=NULL may later acknowledge while remaining uncertain with no timestamp fabrication and no new admission.

### Credential FK decision

Fixture version1 has no credential FK because both credential columns are required NULL. This does not claim credential existence/ownership validation. Do not declare a nonexistent FK to connection_credential(connection_id,credential_version,owner_user_id), and do not alter007 uniqueness implicitly.

A future separately approved one-key extension could add a credential_kind discriminator and use the two existing targets together: FK(connection_id,credential_version)→connectionCredential PK plus FK(connection_id,owner_user_id,credential_kind)→connection unique triple, with nonnull/pair/kind checks. The credential row's existing parent owner/kind FK then links the same connection. Current-version, active state, expiry, key-check and revocation still require sorted connection locks and the secret-owning service. No native/tool/API-key enablement or new007 column/index is authorized here.

## Canonical bytes and identity obligations

Store text, not jsonb, for canonical byte equality. PostgreSQL can check byte bounds and JSON array shape; it must not normalize/pretty-print the authoritative string. Canonical text uses valid UTF-8 without NUL, lone surrogates or extra content. SQL shape/digest regex checks do not establish the versioned tuple or its correspondence with scalar columns. PostgreSQL CHECK is row-local; cross-table facts and genuine launcher provenance require the service boundary. [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)

LaunchSpec storage uses the exact tuple already hashed by digestLaunchSpec:

```text
["zetta.launch.spec",1,
 [actorId,runId,attemptId,botId,conversationId,configurationId,routineIdOrNull,delegationIdOrNull],
 leaseId,fence,recipe,fixtureCase,policyVersion,deadlineEpochMs,
 [deadlineMs,maxInputBytes,maxOutputBytes,maxFrameBytes]]
```

The future storage codec must decode that fixed tuple to parseStoredLaunchSpec, then re-encode exactly; fresh admission still uses parseLaunchSpec. This encoder/decoder is not presently exported by008;010c2 schema must not pretend it exists or add it incidentally. The later bounded row/service child owns the small reviewed codec or coordinated008 export. Compare run/attempt/context and configuration to009 canonical input and locked rows; fixture requires routine/delegation null and supported interactive/setup producer. launch_spec_digest must equal digestLaunchSpec. Reconstruct trusted policy from immutable installation/policy/image fields, expandFixtureRecipe and compare launch_identity_digest, including the approved recipe code/policy binding. Reject incompatible009/008 budget promises rather than silently truncate.

canonical_action must pass decodeDispatchAction, exact re-encoding and digestDispatchAction. Compare every scalar tuple field to grant columns and locked claim/attempt, including action ID/kind/sequence, owner, lease/generation, receipt, installation/policy, null credentials and expiry. Activation launchIdentityDigest must match the claim; input byte digest/count/EOF must match a fresh bounded copy reconstructed from private009 input and the actual approved framing. Real cumulative bytes, next sequence/EOF and no outstanding prior action are checked across the locked claim/grants and launcher facts. A parsed stored digest is not proof of transmitted bytes.

No database SHA extension is required. Service recomputes SHA256 over canonical UTF-8; DB digest/shape constraints plus immutable text stop accidental mutation but do not authenticate a malicious DB operator. Same-ID replay compares exact canonical text, not only digest, before returning inert status. Unknown commit rereads the same claim/action ID; it cannot create another ID to evade a spent sequence.

## Triggers, monotonicity and service release

Use generated Drizzle DDL for tables/FKs/checks/indexes, followed by an explicitly authorized custom feature migration for these OLD/NEW guards:

| Guard | Required behavior |
| --- | --- |
| dispatch_capacity_frozen | Reject UPDATE/DELETE/TRUNCATE after explicit bootstrap. |
| dispatch_claims_identity_immutable | Reject changes to attempt/run/owner/generation/lease/claim-operation/installation/policy/spec version+canonical+digests/image/deadline/created_at. |
| dispatch_claims_initial | INSERT permits only revision1, updated_at=created_at, resource_state=not_submitted and all receipt/prepare/pending/cleanup/cancellation/release fields NULL. Recovery never inserts a pre-spent or already-cleaned claim. |
| dispatch_claims_forward_only | Receipt, prepare intent, cancellation pair, cleanup pair and release bind once; no clearing/replacement. Once prepare exists state cannot return to not_submitted. Cleaned cannot regress. Released row permits only exact no-op. No new pending operation after cleanup/release. |
| dispatch_grants_identity_immutable | Reject changes to id,claim ownership tuple,action ID/kind/sequence,canonical/digest,credential pair,expires_at,created_at. |
| dispatch_grants_forward_only | Enforce the state/delivery/time transitions above; no reset/reissue or terminal mutation. |
| dispatch_revision_monotonic | For a changed claim/grant row: OLD.revision<2147483647, NEW.revision=OLD.revision+1, NEW.updated_at>=OLD.updated_at. Exact no-op retains both; insertion1/equal times. Do not independently increment run revision here. |
| dispatch_tombstones_retained | Reject DELETE and TRUNCATE for both claim/grant tables, including released/expired rows. Future retention needs reviewed maintenance; no cascade or ordinary service deletion. |

Use fixed SQLSTATE23514 and stable constraint names for guard rejections. Restrict these triggers to row-local OLD/NEW checks; they must not take capacity/membership/run locks after a claim/grant lock or create a hidden reverse edge. PostgreSQL supports row UPDATE/DELETE and statement TRUNCATE triggers; actual generated/custom behavior must be exercised. [PostgreSQL trigger behavior](https://www.postgresql.org/docs/18/trigger-definition.html)

Release is a trusted service transaction, not a public flag setter. Lock the relevant membership row (including removed membership for safety reconciliation), run, attempt, claim and grants in order. Read/validate actual logical terminal state from the locked run/current attempt; verify exact immutable identity, no outstanding resource operation, and one of:

1. **Never submitted:** prepare_intent_at is still NULL under claim lock, resource_state=not_submitted, receipt/pending absent, and no action was admitted. The commit-before-prepare protocol is the proof; no external absence query is used.
2. **Removed:** the fixed authenticated launcher adapter supplies an exact owned receipt/journal/installation/attempt/lease/fence/recipe identity observation with confirmed removal and all relevant resource operations settled. Validate008 ownership and operation facts before clearing the pending pair and recording cleanup. A stopped process, unknown response, missing receipt or one empty inventory is insufficient.

Persist cleanup kind/time and released_at in that ordered transaction only after logical terminal validation; released_at>=cleanup_confirmed_at and >=actual terminal finish time. Cancel still-pending grants in the same transaction as needed; keep issued/uncertain grant tombstones. External-effect uncertainty may remain after authoritative resource removal, but still bars replay of that logical work. Row checks cannot establish external truth or enforce a cross-row terminal status by themselves. The schema test must distinguish those structural guarantees from future real service tests; do not claim that arbitrary direct SQL setting cleanup fields is authenticated backend evidence.

## Lock order, occupancy and cancellation

Runtime order stays **capacity → membership → sorted connections → connection key-check → sorted runs → sorted attempts → sorted claims → sorted grants**. Fixture paths skip connections/key-check. Every mutation takes a forward subsequence and compares current row revision under lock; CAS is not a substitute for locks. The existing administrative identity prelude remains earlier and separate. Existing run-attempt triggers reacquire their run; legitimate service paths already hold it. Never call applyRunTransition for the first time after holding a claim/grant: acquire run/attempt first and preserve that order.

Every occupancy increase takes the singleton first in READ COMMITTED. After ordered identity locking/revalidation, use one aggregate statement over ALL claims in the selected installation with released_at IS NULL: total count plus owner FILTER count. Gate serialization covers concurrent insertions; release cannot increase occupancy and needs no capacity lock. An uncommitted release remains conservatively counted. Do not lock counted claim rows out of order, decrement a stored counter, omit expired/terminal/unknown claims, or truncate the aggregate to1024. The pure projection's1024-row bound is useful for bounded snapshots; the production SQL aggregate counts the complete set. A READ COMMITTED statement sees one statement snapshot. [PostgreSQL isolation](https://www.postgresql.org/docs/18/transaction-iso.html)

Assignment of the existing attempt lease and insertion of its claim commit together. The claim constructor's fresh bounded deadline is derived once from DB time and the authorized input budget. Unique attempt and claim-operation identity serialize same-attempt competition; insertion conflict rereads canonical equality and returns status, not permission to prepare. No DB lock spans filesystem, launcher, systemd, provider or human I/O. Prepare/action intent commits before submission; unknown commit issues no I/O and preserves occupancy/non-reissuability until same-ID repair. No automatic replacement attempt or lease.

Claims use the008 reason vocabulary. Owner request maps009 owner_requested→claim owner and persists the existing009 cancellation transition. Backend deadline/revocation/shutdown/recovery records the corresponding claim reason; it must never write owner_requested or set owner-request time on behalf of a user. The current009 owner-only cancellation schema/parser cannot represent those backend reasons.010c2 only stores claim intent; a later separately reviewed009 backend terminal/cancellation extension is required before operational dispatch. Until then no worker is enabled that pretends backend intent is owner intent. Completion already committed stays terminal; cancellation already committed prevents later success under the future combined service transaction. First reason/time are sticky; subsequent safety cancellation does not rewrite original provenance.

## Feature-only generation and executable proof plan

After design acceptance, propose010c2 schema-only ownership of packages/db/src/schema/dispatch.ts, its focused schema test, the additive schema/index.ts export, packages/db/drizzle.dispatch-test.config.ts, and packages/db/dispatch-test-migrations/. The feature config follows the existing run-only config: schema points solely to dispatch.ts, output solely to dispatch-test-migrations, PostgreSQL public schema, no environment import or database credentials. Referenced existing tables are imports/FK targets, not newly exported migration tables. Reject generated output that creates/alters/drops auth, identity, connection or run tables.

The installed drizzle-kit1.0.0-rc.4 currently uses per-migration migration.sql/snapshot.json. Future commands from packages/db are the installed Bun invocation with --no-env-file and the feature config: generate --name=dispatch_initial, then generate --custom --name=dispatch_guards for approved trigger SQL. Generator owns snapshots and lineage; do not hand-invent snapshots or edit generated initial DDL. Run generation again to show no unexpected delta. This is a proposal to use the installed generator, not a command run here. Drizzle documents custom migration generation for SQL outside schema generation. [Drizzle generate](https://orm.drizzle.team/docs/drizzle-kit-generate)

Actual PostgreSQL proof is a separate source/freeze/authorization step after schema review. Extend the guarded disposable proof lineage with a new dispatch proof adapter that first verifies accepted identity/connection/run migration hashes and then dispatch hashes. Keep legacy allowlists/helpers frozen; do not point the proof at an app DB or relax target guards. Follow the existing bounded client/SQLSTATE/pg_blocking_pids pattern. Reject an unrecognized server/version or unsupported IS JSON syntax; pin actual server/image in the proof receipt. Apply only on the explicitly authorized disposable target, never during this design or offline generation.

| Future proof ID | Exact observable and boundary |
| --- | --- |
| S1 schema positive | Explicit synthetic singleton, valid owned run/attempt lease, claim and pending activate/input grants commit. Read exact columns/canonical bytes/revisions back from fresh clients. |
| S2 identity/FKs | Missing attempt, foreign run/owner, wrong policy FK, duplicate attempt/action/sequence/claim operation or installation receipt fail the named23503/23505 constraint. Multiple NULL receipts are allowed. No owner-triple credential FK appears. |
| S3 closed rows | Nonnull fixture credentials, unsupported kind/version, oversize/malformed JSON, invalid digest, counters/time infinity/chronology, incomplete pending/cleanup pairs and release with missing cleanup/pending absence fail named23514 checks. |
| S4 immutable/tombstones | Attempt/lease/spec/identity/action/expiry changes, receipt replacement, release resurrection, revision rollback/jump/exhaustion, issued→pending, acknowledged→unknown, cleared issue/cancel/cleanup times, DELETE/TRUNCATE fail exact guards. No-op matching rows remain unchanged. |
| S5 grant truth | Pending→issued once, unknown commit represented uncertain with issued_at NULL, late acknowledgement keeps that null and uncertainty, issued expiry never becomes no-effect, cancelled/expired never admit. Exact pure parser readback must agree with DB combinations. |
| R1 same attempt | Two independent sessions contend on gate/run/attempt. Observe blocking through pg_blocking_pids; after release exactly one claim/lease identity exists, loser rereads without a second intent. Service admission proof required, not only unique-index failure. |
| R2 capacity | Different owners race at global2/per-owner1. All insertions take gate; a terminal expired unknown claim remains counted. A blocked uncommitted release cannot admit over capacity; a committed authoritative release permits exactly one new claim. |
| R3 settlement/release | Real service rejects release while logical run/attempt nonterminal, operation pending, receipt/identity changed or cleanup unknown; never-submitted and exact removed terminal cases release once. Raw row CHECK tests cannot substitute for this provenance proof. |
| R4 grant CAS/cancel | Two workers use same revision/action; exactly one newly committed admission, stale/replayed status produces no synthetic transport call. Both cancellation/issue and expiry/issue orders persist one coherent result. Unknown commit/send retains tombstones and never invokes transport twice. |
| R5 shared ordering | Observe membership removal/claim, connection revoke or replacement/future issuance, renewal/cancellation/release and existing deferred attempt-pointer triggers on independent sessions. No later capacity acquisition or DB/file-lock inversion. Credential races remain gated until their extension exists. |

All actual integration scenarios need finite timeouts, explicit ready/blocking handshakes, independent connections, fixed error-code/constraint comparisons, source-bound logs, exact final occupancy and complete fixture/client/container cleanup. No sleeps as lock evidence. No schema-string tests presented as DB enforcement. Schema proofs may exercise direct SQL facts, but authority, full canonical equality, backend settlement and concurrency require the later real service boundary. No operational tests have run for this design.

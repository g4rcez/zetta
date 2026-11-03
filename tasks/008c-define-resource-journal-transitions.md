# RFC-008c: Define resource journal records and transitions

- **Parent:** [RFC-008](008-implement-isolated-process-supervision.md)
- **Status:** Accepted pure source foundation after coordinator verification and independent CLEAR/APPROVE. Parent008 remains incomplete.
- **Decision:** Accepted [runtime supervisor ADR](../docs/decisions/runtime-supervisor.md) and coordinator acceptance of 008b/008b1.
- **Scope:** Five product files: new launch-journal.ts, journal-transitions.ts and their two focused tests; a small parseStoredLaunchSpec export in launch-spec.ts. This task and unique evidence are additional documentation. No shared task status or other source was edited.

## Completion record

The version-1 readonly record retains the full secret-free LaunchSpec, trusted installation/image/policy, spec and recipe identity digests, secure random receipt and ownership label, generated exact container name and runner unit, acknowledged full container ID, resource phase, pending operation, latest acknowledged operation, cancellation intent, last admitted input metadata and aggregate bytes, absolute deadline through the embedded spec, clock observation, resource terminal fact and separate cleanup state. Construction rechecks fresh admission. Historical parsing reuses the existing spec shape schema without inventing a clock or granting admission.

The parser takes a trusted operator policy and optional expected receipt for direct lookup. Startup scanning needs no second index or external anchor. It checks strict fields, tuple/digest consistency, policy identity and legal state relationships. Protected storage supplies authenticity: these unkeyed digests do not defend against a trusted host/root coherently rewriting a record. The future writer must provide private modes, no-symlink traversal, single-writer ownership and atomic/fsynced storage.

Transitions produce immutable drafts. A new effect carries a pending operation ID/type/sequence that must be durably committed before submission. Exact replay of the retained pending/latest acknowledged operation is inert; stale operation sequences and changed replays fail. Internal backend acknowledgement facts require exact receipt/attempt/lease/fence and full resource ID/name/label/recipe identity. This is not an HTTP acknowledgement API. There is no caller-set settled flag.

Unknown create/start/input/stop/remove responses retain the pending operation, close admission and quarantine. An absence observation cannot clear it. A matching late acknowledgement may settle ownership for stop/removal; uncertainty and cancellation stay sticky. Cancellation first closes admission; stop acknowledgement records process_stopped while cleanup remains pending. Only the exact acknowledged removal confirms cleanup. An unsubmitted intent can become a not_started tombstone; terminal records cannot restart. No transition records logical run success.

Input metadata admits only the next sequence within frame/aggregate budgets. Admission and EOF survive response loss; replay cannot issue another effect or increment bytes twice. The bounded record retains the current pending and latest acknowledged operation, not an unbounded request history; older sequences fail closed. Input identity belongs to its receipt/sequence, and the input ID is bound to that admission. Actual bytes, prompts, credentials and output are never persisted here.

## Evidence

Exact scenario matrix, commands, diagnostics, source hashes and limitations.

- Red first: missing new modules; additional red reproduction caught an injected container ID lacking any acknowledged ownership operation, then the parser was corrected.
- 121 focused spec/recipe/journal tests pass with 235 assertions; this includes the existing 62 spec/recipe tests.
- Strict TypeScript including the native proof passes; all five changed files have no LSP diagnostics.
- Native pure journal proof passes nine safe boolean checks, with daemonEffectsIssued=false and durableWritesClaimed=false.
- All five modules/tests remain below250 nonblank/noncomment lines. Optional skill checker reports unresolved caller-project TypeScript; no install or checker-success claim.

## Exported contract and next consumer

- launch-spec.ts adds parseStoredLaunchSpec(raw): LaunchSpec. Fresh dispatch still calls parseLaunchSpec(raw, trustedAdmission); createLaunchJournal also rechecks this.
- launch-journal.ts exports LaunchJournal, JournalOperation, LaunchJournalError, createLaunchJournal(recipe, admission), parseLaunchJournal(raw, { policy, receiptId? }), parseJournalOperation(raw) and the internal tuple digest helper journalDigest.
- journal-transitions.ts exports JournalEvent, JournalDraft and transitionJournal(record, event).

The next bounded task008d must first review filesystem single-writer/locking and crash behavior. Its backend must serialize transitions, durably commit each draft before its effect, persist facts before replying, and validate actual Docker ownership/configuration before emitting created_verified. started/input_written/stopped/removed are trusted observations of completed exact operations; stopped must attest the owned process tree, and removed must attest exact removal after outstanding operations settle. Lost submission or response must emit unknown and never resubmit the pending effect. On restart, pending effects are unresolved until reconciled; reloading a record is not permission to execute its pending operation.

Coordinator independently repeated all121 tests/235 assertions, the documented strict command and nine-check native pure proof, all exit0. [Independent review](../docs/reviews/runtime-008c-review.md) reports CLEAR/APPROVE with no blocker and matching hashes.008d is assigned design first; neither acceptance nor these in-memory checks establishes filesystem durability or runtime supervision.

Trusted clock confidence, fresh app authorization, HTTP parsing/authentication, actual byte forwarding, fsync/rename/locks, systemd runner, Docker inspection and operational containment remain unimplemented. Unsupported or rejected backend outcomes without the exact affirmative facts remain quarantined for repair. No filesystem writer, Docker/systemd/service, DB, environment, install, provider or Git operation was performed for this slice. Parent008 stays operationally incomplete.

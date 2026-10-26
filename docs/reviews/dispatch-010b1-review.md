# RFC-010b1 independent review

codeQualityStatus: CLEAR
recommendation: APPROVE
blockers: none for the pure contract/state slice

## Findings

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none.

Reviewed dispatch-contract.ts, dispatch-state.ts and both tests against accepted durable-dispatch.md, task010b1 and the author evidence/native driver. No product edits or database, Linux, provider or launcher operations were performed.

- dispatch-contract.ts:10–51 implements the exact17-position domain/version tuple and fixed activation/input descriptors. Every identity field contributes; canonical decode requires exact re-encoding. Strict shape, canonical UUIDs, bounded IDs/counters/epochs, lower-case digests and paired-null fixture credential fields reject unsupported actions/bindings. Activation and input sequence spaces remain distinct through kind.
- dispatch-contract.ts:52–65 copies bounded input bytes synchronously, hashes their exact bytes and retains only digest/count/EOF/sequence. The minimum possible aggregate bound rejects impossible late sequences. This is not proof of actual remaining cumulative budget or transport bytes; those correctly remain integration obligations. Parsed objects/descriptors are copied/frozen.
- dispatch-state.ts:13–45 validates stored chronology and state/delivery/null combinations. Fresh grant creation checks30second expiry and60second attempt policy. Transition identity includes exact canonical action and grant ID plus current revision; stale CAS is rejected before inert replay. Issue admits only pending; cancellation/expiry/uncertainty never restore pending or permit reissue. Mutation at exhausted revision fails.
- Unknown commit may lack issuedAtMs. A later exact trusted acknowledgement leaves state uncertain and issuedAtMs null, changes only the delivery fact, and never grants readmission. This preserves uncertainty rather than fabricating an issue timestamp. Cancellation after issuance retains spent admission and cancellation intent; expiry never manufactures known non-delivery. Matching current-state acknowledgements retain revision/timestamps; conflicting identity and known-to-unknown facts deny.
- dispatch-state.ts:119 onward validates the complete bounded capacity snapshot, rejects duplicate attempt/claim-operation identities, foreign installation/policy and inconsistent resource/pending/release chronology. Every unreleased claim counts, including terminal, expired, stopping and unknown resources. Only terminal plus confirmed cleanup/no pending operation and release time removes occupancy. The fixed global2/actor1 policy is enforced without a mutable counter. Actual cleanup/provenance and full-snapshot completeness remain trusted DB boundary obligations.

## Independent checks and source identity

Reviewer reran the new suite:72 tests /129 assertions, zero failures. Strict TypeScript over all four files and the retained native driver passed. Native execution passed11 checks while explicitly reporting executionAuthorityIssued=false, externalEffectsIssued=false, durableWritesClaimed=false. Exact commands/output are focused.log, strict.log and native.log in the review evidence directory.

The oversized snapshot test independently passed within that suite:1025 records rejected with zero element-getter visits. No redundant array guard is needed for the installed parser behavior. Independent source-hashes.json matches the author's source.sha256:

- dispatch-contract.ts: 8b99e2ae6c12a44fc5589938a70df724a341e704714f22ab7e72e9f1faa5f62f
- dispatch-state.ts: 7841a8ea2f032f572ea43224cb079fe5a3b0a33fcccb21531c4d71b71c8982c1
- dispatch-contract.test.ts: 37958def872377ea55afccf660cab03406944e012d7f3dabd607a759fec231ce
- dispatch-state.test.ts: eefbdc9e71ec73fe85e931329bfcb6f9bf3355c7b64b3fa5fad37b1afe9caed1

No concrete defect required an additional counterexample probe. The author's wider223-test regression receipt is separate from this reviewer's72-test repeat.

## Quality and acceptance boundary

Code-review, programming and remove-ai-slops perspectives were consulted/applied. Independent literal canonical tuple/hash oracles, legal semantic substitutions, behavioral once-only/CAS transitions and occupancy assertions are meaningful. No deletion-only/removal-request tests, tautological tests, untyped production escapes or needless framework were identified. Strict parsing belongs at these persisted/request-shaped boundaries; canonical decoding is intentionally exact, not needless normalization.

Approve the pure drafts only. They do not issue ExecutionAuthority, authenticate structural inputs, commit grants or authorize I/O. Future source/schema work must prove private live-transaction provenance, fresh membership/current claim checks, full ordered lock/claim/grant snapshots, semantic-action anti-reminting and uniqueness, immutable bindings, aggregate input budget, real commit-before-send and unknown-result no-resend. Actual database races, removal/reenrollment, launcher delivery and native/provider readiness remain required later gates. Parent010 is incomplete.

Evidence directory: `.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/dispatch-010b1-review`.

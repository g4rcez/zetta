# RFC-009b2: Durable run contract and pure state transitions

- Parent: [RFC-009](009-persist-run-lifecycle-and-idempotency.md), incomplete pending store/database proof.
- Status: accepted pure foundation after009b2a correction and independent CLEAR/APPROVE; parent009 remains incomplete.
- Decision: accepted [durable-runs ADR](../docs/decisions/durable-runs.md), root clarification of pre-admission no_effect, owner_requested cancellation, independent stop facts and stable terminal replay.

## Contract handoff

Owned files: runtime `run-contract.ts`, `run-state.ts` and their two focused test files. No schema, service, query, launcher, composition or environment changes.

`parseSubmitRequest` copies/freezes strict nested input, normalizes absent model/resume to null, bounds UTF-8 prompt and complete encoded snapshot, and denies native harnesses/nonempty connections/resume with fixed unsupported. This parser accepts trusted fixture-producer metadata only; it does not establish actor issuance, bot/conversation/config existence, readiness or public submission authorization. User prompt content is private text, not automatically scrubbed of arbitrary secrets. Extra credential/environment/context fields are rejected.

`canonicalRunInput` returns canonical UTF-8-compatible JSON text, not a digest. Exact tuple is `["zetta.run.input",1,requestKey,origin,botId,conversationId,configurationId,configurationVersion,prompt,harness,model,[deadlineMs,maxEvents,maxOutputBytes,maxToolBytes,maxToolCalls],[[reference,credentialVersion],...],resumeReference]`. Connection order is preserved by the encoding; the initial supported path requires an empty array. Duplicate references fail syntax before unsupported. `decodeRunInput` requires exact re-encoding, rejecting alternate escaping/spacing/trailing data. Generated run/attempt IDs, owner identity and receipt time are excluded from semantic input. `toHarnessInput` constructs006 context from a separate strict trusted stored identity tuple and parsed resource references; it does not authenticate that tuple.

`parseRunDto`, `parseRunResult`, `parseRunResultDto`, `parseOwnedRunRequest` and `parseCancelRunRequest` expose closed safe shapes and fixed errors. Row adapters in009c must explicitly project actual columns, convert dates to valid epoch milliseconds and invoke these parsers. Results remain private, bounded and source-bound; no raw SQL/secret/exception cause is exported. Result lastSequence is0..1000 and <=stored maxEvents.

`parseRunState` accepts only lifecycle identity/facts; no actor/config/input patch is possible. `transitionRun(state,token,fact)` checks run/attempt/generation/lease identity, revision CAS and temporal/counter bounds. Internal fact types are claimed/admitted/cancel/completed/lost/stopped. They are trusted backend observations, not public authority or a claim worker. Claim records an inert lease with no_effect; admission moves uncertainty and is denied after cancel/stop/expiry. Cancel of queued work finishes no_effect; cancel of running work records owner_requested intent. Completion or loss after committed cancel settles cancelled. Lost work otherwise becomes interrupted/uncertain. Stop confirmation is independent and never clears effect uncertainty.

Terminal replay compares normalized status/effect/result (including result sequence), ignoring newly generated receipt time and preserving original finishedAt/revision. Matching replay and cancellation of already terminal work return current state; foreign/stale attempt identity always fails. Conflicting result fails. No retry/renewal API, external effect, repository or worker exists.010 must obtain these backend facts from authoritative reconciliation and carry the full lock/authorization/lease protocol; callers cannot treat structural parsing as that proof.

## Verification and remaining gates

[Evidence report](../.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/run-contract-009b2/report.md): red-first missing-module failures, then19 passing tests/138 assertions; focused strict TypeScript exit0; four TypeScript files LSP-clean, including final changed test recheck. Modules130/107 lines and tests91/103 lines, below250. Source hashes bind evidence. No installs, provider calls, DB/server/container starts or Git mutations.

009c still owns issued ActiveActor plus fresh membership locks, owner-scoped real row parsing, exact snapshot comparison and atomic persistence.009b1 owns schema/migration constraints. Actual concurrent terminal races, restart storage and dispatcher capacity remain unproved. Parent009 is not completed by these pure tests. Freeze these files for review; any schema mismatch must be coordinated rather than patched across ownership.

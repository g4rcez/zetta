# RFC-009b2a: Harden persisted run validation

Status: accepted after coordinator verification and independent CLEAR/APPROVE. Parent009 remains incomplete.

Root authorized the narrow M1/M2 corrections from [009b2 review](../docs/reviews/runtime-009b2-review.md). Only runtime `run-contract.ts`, `run-state.ts` and their two test files changed, plus this task/evidence. No schema, service, dispatcher or producer authority was added.

M1: `parseRunState` and `parseRunDto` now reject nonnull owner cancellation intent unless status is running or cancelled. M2: `parseRunState` and `parseRunResultDto` now require a complete nonnull validated result for succeeded/failed. The metadata-only RunDto retains its original shape;009c must validate complete stored state before projecting metadata. Legitimate cancelled/interrupted null results remain accepted.

Added individual negative tests for all six incompatible cancellation reader cases and all four missing-result cases, with running/cancelled intent, completion-first null intent, complete results and cancelled/interrupted null results as positive controls. Added explicit preservation of normalized terminal replay: after cancellation, equal cancelled/known/result facts replay across differing raw succeeded/failed outcomes while preserving original timestamp/revision. No new terminal receipt identity was introduced.

Evidence: red-first20 pass/10 fail; final30 pass/179 assertions; strict TS with exactOptionalPropertyTypes exit0; four-file LSP clean; original independent M1/M2 probes exit0 after correction. Prior failure artifacts remain untouched. Frozen hashes recorded for the next reviewer.

No database/runtime/native proof performed. Actual owner membership, row mapping, persistence CAS and producer/resource authorization remain009c/010 and downstream work.

Coordinator independently repeated30 tests/179 assertions, strict TypeScript and both original regression probes, all exit0 with valid controls retained. The linked independent review is now CLEAR/APPROVE on matching hashes and preserves the original BLOCK history.009c1 is assigned the owned store and complete row validation; this acceptance adds no producer/worker authority.

# RFC-009b2 independent review

## Current verdict — RFC-009b2a delta

codeQualityStatus: CLEAR
recommendation: APPROVE for the pure009b2 foundation
blockers: []

M1 and M2 resolved. The original BLOCK review and red probes remain below as historical evidence; this section supersedes that verdict on the current hashes.

Current findings by severity: CRITICAL none; HIGH none; MEDIUM none; LOW none.

Inspected the exact guards: run-state.ts:22 rejects nonnull owner intent outside running/cancelled, and run-contract.ts:93 applies the equivalent DTO check. run-state.ts:26 requires nonnull result for succeeded/failed; run-contract.ts:113 applies that requirement in the result envelope. Existing result-schema validation and maxEvents bound still run. Metadata-only RunDto remains unchanged in shape;009c must validate complete rows/state before projection.

Regression tests include all six M1 negatives and four M2 negatives, plus valid running/cancelled intent, null intent after completion-first, complete success/failure results, and cancelled/interrupted null result controls. The normalized cancellation replay case confirms different raw succeeded/failed outcomes with identical cancelled/known/result payload remain idempotent and preserve timestamp/revision. No new hidden raw-outcome storage or authority was introduced.

Independently executed on frozen current source:

- Focused two-file Bun suite: **30 pass,0 fail,179 assertions**, exit0.
- Exact strict command in run-contract-009b2a/report.md including exactOptionalPropertyTypes: exit0,zero diagnostics.
- Original cancel-precedence-probe.ts: exit0; all six invalid combinations rejected. Captured cancel-precedence-009b2a-green.log beside original red log.
- Original missing-result-probe.ts: exit0; four invalid combinations rejected and four valid controls accepted. Captured missing-result-009b2a-green.log beside original red log.
- Recomputed all four hashes and compared author manifest: exact matches.
- Inspected retained failing-first red.log:10 failures,exit1 before correction. Writer LSP receipts are recorded but not independently rerun.

Current SHA256:

- run-contract.ts: a165b61b221c3ee5644f750cd7dd1486e70344c227aff3deafc9fb73c2004d25
- run-state.ts: 14e60117b37c7603d281784dfbe28bbeeac6d3ea27aa87bf4e5e5b3bbd05f757
- run-contract.test.ts: c96a4c629846c82b155f0bad8f9ad52c4c177048ab03d208d16522d8c406f400
- run-state.test.ts: dcae27d09e7808f914435cfd2f2a50a0c22a5a4a546a43e3530b00c22be46efb

Programming/remove-ai-slops/code-review perspectives reapplied. The new tests protect actual persisted-reader semantics with positive controls, not implementation text or requested-removal assertions. No unrelated abstraction or new parsing layer. No further delta finding.

Approval covers pure contracts/state only.009c store remains unimplemented; actual owner authorization, row mapping, persistence CAS, concurrent state updates and durable restart/worker integration still need their assigned proof. This reviewer changed no product source and started no DB/service/native operation.

## Historical review — superseded BLOCK verdict

codeQualityStatus: BLOCK
recommendation: REQUEST_CHANGES
blockers: M1 cancellation-precedence validation; M2 missing success/failure results.

## Findings by severity

CRITICAL: none. HIGH: none.

MEDIUM M1 — **Reject cancellation intent on incompatible terminal states.** At apps/server/src/modules/runtime/run-state.ts:21, parseRunState checks only that cancellation timestamp/reason appear together; its remaining refinements do not restrict these facts to running/cancelled. Likewise run-contract.ts:85-92 validates timestamp ordering but permits owner cancellation intent on succeeded, failed and interrupted DTOs.

An otherwise valid claimed/started state with created=1, claimed=2, started=3, cancelRequested=4, finished=5 and owner_requested is accepted for all three incompatible terminal statuses. The DTO reader accepts the equivalent three records. The accepted ADR requires earlier committed cancellation to settle cancelled, and current schema run_attempts_cancellation_check restricts owner_requested to running/cancelled. transitionRun already produces cancelled correctly; these persisted-row readers are inconsistent with that contract and would bless corrupted/misassembled rows instead of returning storage_unavailable.

Required narrow correction: add the status restriction in both readers. Add negative cases for all three terminal statuses, with valid running intent and cancelled terminal positive controls. Preserve completion-first terminal states with null cancellation intent, normalized terminal replay and independent stop facts. No schema or production composition change is required for this finding.

MEDIUM M2 — **Success/failure must carry the validated result.** run-state.ts:24-38 and run-contract.ts:111-117 accept succeeded/failed with result=null. Completed facts always require the complete result, and the coordinator confirmed no resultless success/failure is intended. Reject null result for those two statuses in parseRunState and parseRunResultDto, preserving legitimate cancelled/interrupted-null controls. parseRunDto intentionally contains no result and cannot enforce this field; the row assembler must validate the full state before projecting it.

Independent missing-result-probe.ts in the same review evidence directory exits1 and missing-result-red.log records all four invalid state/resultDto combinations accepted, while four cancelled/interrupted-null positive controls remain accepted. Exact invocation: `bun --no-env-file run local evidence`. Same frozen source hashes as M1. No production edits.

LOW: none.

## Independent red reproduction

Artifact: local evidence

Exact invocation from repository root:

```sh
bun --no-env-file run local evidence
```

Exit1, retained cancel-precedence-red.log: each state/dto case for succeeded, failed and interrupted emits accepted=true, expectedAccepted=false. Synthetic identifiers only; no DB/service/native effect. The probe exits0 only when all six are rejected, so the reproduction is not a success-message-only assertion.

## Checks and other assessment

Independently ran focused Bun tests: 19 pass, 0 fail, 138 assertions. Independently ran writer strict command with additional exactOptionalPropertyTypes: exit0, no diagnostics. These passing tests do not cover M1.

Input parsing is strict throughout the nested envelope, clones/freezes supported values, preserves Unicode and normalizes only omitted model/resume to null. Canonical fixed tuple includes every supported semantic field and all budgets; exact re-encoding rejects alternative whitespace/escaping. Escaped encoded-size limit is checked separately from prompt bytes. Native harnesses, nonempty connections/resume and extra authority fields fail; trusted context construction does not pretend to authenticate its identity. Supported canonical equality includes requestKey but excludes generated IDs/time/owner, consistent with the handoff.

Results and DTOs expose bounded closed shapes, fixed error codes and sequence bound by stored maxEvents. No plaintext resolver or public worker authority is added. Row projection/date conversion and actual owner linkage remain009c responsibilities.

State transitions check attempt/run/generation/lease before replay, and revision/time/exhaustion before a new mutation. Claim remains inert no_effect; admission closes after cancellation/stop/expiry and establishes uncertainty. Queued cancellation creates no lease. Running cancellation wins completion/loss; loss remains uncertain. Stop remains independent and cannot clear effect uncertainty or reactivate work.

Coordinator explicitly confirmed normalized persisted status/effect/result (including sequence), with attempt/generation/lease, is the terminal replay identity. Consequently after prior cancellation, raw succeeded versus failed outcomes with identical complete normalized payload intentionally replay as cancelled/known. Changed effect or result conflicts. Receive-time changes preserve original finish/revision; no extra raw-outcome receipt storage is required. This accepted clarification is not a finding.

## Skill perspective and limits

Applied previously loaded programming/TypeScript, remove-ai-slops and code-review-and-quality perspectives. Independent tuple oracle and semantic substitutions are meaningful; pure lifecycle examples test both orders rather than a fake ORM. No deletion/prose tests, unnecessary framework or unsafe type escape found. M1 is a concrete boundary correctness gap, not a style concern.

No product code edited. No DB/native/provider/launcher/process-restart proof performed. Real membership, owner-scoped reads, persistence CAS, concurrent cancellation/completion, DB constraints and reconciliation remain009b1/009c/010. This review does not validate a claim worker or public producer.

## Reviewed hashes

- run-contract.ts: 37c7eab79abc78d100aa4f87037879fc8d042b8f8991ff2464b3e00ea8f2bea6
- run-state.ts: 033e982a55644f904c468aa6bcbc84d472c1f44735be44fc4baddd486dcf591e
- run-contract.test.ts: 544b0387b62905c10c3449892409141ce329326b99e10d96beb197a6b2c09e43
- run-state.test.ts: a72cb9799750f8b24feac669d6d21daa52776031d011efc1a83142c740cffafe

All four independently matched the writer manifest. Context read: accepted durable-runs ADR,009b2 task/evidence and current schema cancellation constraint. Source frozen for this verdict.

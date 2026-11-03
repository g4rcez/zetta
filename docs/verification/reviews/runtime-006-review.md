# RFC-006 independent code review

Reviewed 2026-10-22. Scope: pure contract and synthetic fixture only.

- codeQualityStatus: WATCH
- recommendation: APPROVE
- blockers: []
- Contract readiness: accepted for downstream implementation planning, not production dispatch or native/provider readiness.

## Current verdict: RFC-006a uncertainty correction

This section supersedes the original source-bound approval below. The earlier review missed the public `HarnessError("tool_denied")` callback counterexample subsequently reproduced by the coordinator. The corrected source is now independently reviewed and verified; no unresolved correctness blocker remains.

Final source identity (SHA256):

```text
356837ef7a06ed890d66f1837a223e420af0324708731519b52f6b0cabd9751a  host-tools.ts
59d4d0f6d72cbda060e64c5a28634ef73f4472a4660f94b807fb7f0a89f94981  harness.test.ts
```

The other three runtime file hashes remain the values recorded below. Independently checked all five against `runtime-006a-outcome/source-sha256.txt` in the current G002 attempt; all returned OK. Read the full production patch, new behavioral cases, failing-first log, captured before-source, both proof drivers and `runtime-006a-outcome/report.md`. The captured before-source matches the earlier reviewed `ded2d86c...` hash; the executable baseline copy differs only in its two relocated import paths.

Current severity findings:

- CRITICAL: none.
- HIGH: none remaining. The formerly public-denial misclassification is corrected: `host-tools.ts:43` catches everything from callback entry through result parsing, encoding and byte bounding and converts failures to `outcome_uncertain`. Await covers asynchronous rejection as well as synchronous throws. The gate only treats the private `InvalidToolArguments` marker from a genuinely defined tool as pre-effect denial (`host-tools.ts:90`). The private WeakSet and frozen tool prevent a custom tool from forwarding a nested private validation error after an effect and incorrectly clearing uncertainty. No new public marker or export exists. Custom/public-denial errors stay uncertain. Reauthorization remains a callback responsibility, but public callback denial no longer proves no effect.
- MEDIUM M2: `apps/server/src/modules/runtime/harness.test.ts:1` now has 293 nonblank/non-line-comment lines, exceeding the programming/remove-ai-slops 250-line module threshold. This is nonblocking organizational debt in the expanded test module, not a demonstrated behavior failure. The new cases are useful and must be preserved; a future behavior-based split can separate host-tool gate tests from adapter stream tests. The narrow two-file correction explicitly defers that split rather than adding unrelated source changes.
- LOW: none.

Skill-perspective pass ran using the programming/TypeScript, remove-ai-slops and code-review skills already loaded in this review. The size threshold is the only remaining identified violation. New tests assert actual effect counts, fixed error categories, gate uncertainty, no-effect controls and the terminal stream. The failing-first suite recorded four failures, and the independently repeated old-source driver reproduced the actual bug. No deletion-only, prompt, tautological or implementation-mirroring tests were introduced. The private marker and WeakSet are justified by the demonstrated custom/nested-error boundary; no needless validation or abstraction was added.

Independently repeated on the final hashes:

1. `bun --no-env-file test apps/server/src/modules/runtime/harness.test.ts`: exit 0, 47 pass, 0 fail, 112 assertions (42 ms).
2. `bun --no-env-file run <attempt>/runtime-006a-outcome/verify-before.ts`: exit 0; all four counterexample/cleanup checks true, `reproduced: true`. This intentionally proves the captured old implementation remains wrong.
3. `bun --no-env-file run <attempt>/runtime-006a-outcome/verify-outcome.ts`: exit 0, all 13 checks true. Direct effect executes once, failure and gate are uncertain, duplicate cannot replay, malformed/schema-invalid arguments execute no effect, fixture emits one uncertain terminal and no tool result, signals are cleaned.
4. `bun --no-env-file run apps/server/src/modules/runtime/fixture-run.ts`: exit 0, all eight existing checks true.
5. Repeated the exact strict TypeScript command from `runtime-006a-outcome/report.md`, including `verify-outcome.ts`: exit 0, no diagnostics. LSP receipt was inspected, not rerun. Optional skill checker incompatibility with installed TypeScript and unavailable Biome remain transparently reported by the writer, not claimed passing.

Here `<attempt>` is `local evidence`. Only review artifacts were edited. No production edits, installations, Git mutations, services, accounts, providers or containers were used. All effects in this proof are in-memory counters. Native transport/provider execution, durable replay/recovery and OS containment remain unverified and required separately. Recommendation: APPROVE with WATCH for M2; blockers: none.

## Scope and provenance

Read all five new, untracked files in `apps/server/src/modules/runtime`: `harness.ts`, `host-tools.ts`, `fixture-adapter.ts`, `fixture-run.ts`, `harness.test.ts`. Their complete contents constitute the new-file diff; ordinary `git diff` omits them. No source changes made by this reviewer.

Read `tasks/006-define-harness-contract-and-fixture-adapter.md`, `docs/decisions/ownership.md`, `docs/decisions/execution-isolation.md`, the six-harness compatibility research, `local evidence`, and `local evidence` with its referenced receipts/import guard/source hash manifest. Supported no-network RFC-002 research is the accepted prerequisite for this pure slice. This review does not require or claim native transport, databases, provider execution, credential storage, durable grants, egress or OS process termination.

`shasum -a 256 -c local evidence` independently returned OK for every scoped source file:

```text
5996555e153bec4afbf63085f8b670be1415174eefff216ac59c42bd1b2c0c6e  fixture-adapter.ts
235c8121b7791d2e1743c137778fcfd0b227d9f4ed13a9dbb457c615b7cc6fe5  fixture-run.ts
8c9341ee6090be968bc364ba452e731ffeb64a50d128099b54e2bee900c5f149  harness.test.ts
e1d2d694cf4a812946395b7ef714739d800da44966755efa42d0c31f6ab1e0a7  harness.ts
ded2d86c4f35fdf8b2a12240e37c29043086f889102b6665666c8dc71f99cad2  host-tools.ts
```

## Findings by severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None remaining. M1 resolved by the narrowly reviewed test correction at `apps/server/src/modules/runtime/harness.test.ts:29`: the declaration now supplies all required fields, proves a valid positive control, and changes only the harness identifier before asserting `unsupported`. The original incomplete fixture could reject for unrelated missing fields. Reviewed mutation receipts now show the original test passing despite removal of the harness allowlist and the corrected test failing on that same mutation. This closes the false-confidence issue without production changes.

### LOW

None.

## Skill-perspective check

Ran the review perspectives after loading `code-review-and-quality`, `omo:programming` (including its TypeScript reference), and `omo:remove-ai-slops` from their installed SKILL.md files. Applied their test relevance, boundary, abstraction and type-safety criteria read-only.

M1's meaningful-regression-test violation in both programming and remove-ai-slops is resolved. No remaining violation was found in the reviewed delta. No deletion-only tests, requested-removal assertions, prompt/prose pins, tautological output comparisons, implementation-constant mirrors or untyped escape hatches were found. Tests largely assert effects, denials, observable event sequences and terminal outcomes. JSON parsing, schema checks and byte accounting are justified at the run/frame/callback boundaries. The generic host-tool interface supplies the real adapter/implementation seam required by this RFC; no unnecessary production extraction or speculative universal SDK was found. The test module remains below the skill's 250 nonblank/non-line-comment line threshold; production modules are smaller. Explicit boundary catches sanitize unknown callback/transport failures rather than exposing their details.

## Narrow correction verification

Read `local evidence` and its four underlying logs in the active attempt's `capability-test-fix/` directory: `focused-test.log`, `strict-diagnostics.log`, `before-mutation.log`, `after-mutation.log`. These record 40 passing tests/89 assertions, strict diagnostics exit 0, the original test's false pass under allowlist removal, and the corrected test's expected failure because `imaginary` did not throw under that mutation. The positive control succeeds in the mutation log. The report also retains the exact temporary-directory cleanup/ENOENT receipt. The coordinator independently repeated 40 tests/89 assertions; this reviewer performed the requested source/artifact delta review without another suite run.

Independently recomputed all five source hashes: the test hash is the updated value above; all four production hashes are unchanged. The original `source-sha256.txt` remains a historical pre-correction manifest, while `capability-test-fix.md` binds the final test hash. The original independent 40/88 run below is retained as historical evidence, not mislabeled as final-source execution. Native/provider and operational limits remain unchanged.

## Independently repeated verification

All commands ran without services, installations, containers, provider calls or Git mutation.

1. `bun --no-env-file test apps/server/src/modules/runtime/harness.test.ts`: exit 0; Bun 1.3.14; 40 pass, 0 fail, 88 expect calls, 115 ms.
2. `bun --no-env-file run apps/server/src/modules/runtime/fixture-run.ts`: exit 0; scope `synthetic-contract-only`; `ordered`, `roundTrip`, `success`, `terminalOnce`, `foreignDenied`, `orderRejected`, `cancelled`, `cleanup` all true; `passed: true`.
3. `bun --no-env-file run local evidence`: exit 0; `importWithoutIo: true`, `modules: 4`. Source inspection also found no import-time I/O. This guard covers its named APIs, not all possible OS I/O; a future guard should not be represented as general containment.
4. Strict no-emit TypeScript invocation below: exit 0, no diagnostics.
5. Additional read-only Bun stdin probe: `unrelatedMissingFieldsReject: true`, `completeUnknownReject: true`, `issuedFrozen: true`, `toolFrozen: true`, `issuedMutationRejected: true` (Reflect.set of issued actorId returned false).

```sh
apps/server/node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib esnext --types bun --verbatimModuleSyntax --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch apps/server/src/modules/runtime/harness.ts apps/server/src/modules/runtime/host-tools.ts apps/server/src/modules/runtime/fixture-adapter.ts apps/server/src/modules/runtime/harness.test.ts apps/server/src/modules/runtime/fixture-run.ts
```

Existing LSP receipt reports five files and zero diagnostics; not independently repeated because strict compiler verification was repeated. No configured scanner/lint result is claimed. No web feature is delivered by this slice, so browser validation is not applicable.

## Contract assessment and retained limits

Actor/run/attempt substitution and cross-gate object forgery are denied before effects. Parsed run context and issued requests are frozen. Claiming invocation IDs synchronously before awaiting callbacks prevents both pending and completed replay within this gate. Registered tools provide runtime argument/result schemas; fixed errors avoid callback-detail leakage. Reauthorization remains the trusted callback's explicit responsibility immediately before an effect; matching IDs and opaque references grant no resource authority.

Cancellation closes admission and forwards an abort signal. A pending callback causes an uncertain terminal, suppressing late success; the implementation does not pretend to terminate arbitrary effects. The demand-driven stream emits ordered bounded data events and reserves diagnostic/terminal capacity. Output-byte budget covers data payloads, while bounded identity/diagnostic envelopes are documented overhead. Unsupported model/resume requests reject before execution; missing, duplicate, malformed and out-of-order terminal sequences fail safely. Imports remain inert; the explicit offline runner does actual synthetic work only when called.

Consumers must drain or cancel and close the iterator; execution deadlines begin on iteration. Callbacks must honor the distinction between pre-effect `tool_denied` and an uncertain post-effect failure. In-memory replay protection, uncooperative effects, native byte framing and persistent/session authority remain downstream supervisor/adapter responsibilities explicitly documented in the task. None is treated as proven by these tests. No blocking scope, maintainability or regression issue was found beyond those retained operational gates.

## Artifact placement

`omo-agent-toolkit ulw-loop status --json` reported current attempt `local evidence`. The scoped copy is `runtime-006/G002-use-bun-typescript-and-the-installed-code-review.md` below that directory. This uses a unique runtime subdirectory at the coordinator's direction to preserve another reviewer's existing generic G002 receipt; neither report represents aggregate G002 approval.

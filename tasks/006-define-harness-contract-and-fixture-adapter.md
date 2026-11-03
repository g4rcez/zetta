# RFC-006: Define harness contract and fixture adapter

- **Module:** Execution runtime
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-002](002-prove-multi-user-execution-isolation.md), [RFC-003](003-establish-focused-test-seams.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Normalize only capabilities needed by current bot execution into a typed server-side harness contract.

## Non-goals

No real CLI integration, speculative universal SDK or assumption that all harnesses support the same tools.

## Source anchors and planned changes

- `apps/server/src/modules/runtime/harness.ts (new)`
- `apps/server/src/modules/runtime/fixture-adapter.ts (new)`

## Contract and implementation steps

1. Define versioned capabilities, input/context, connection references, session ownership and normalized event/error/cancellation shapes. Include a typed host-tool callback contract carrying a run-bound invocation ID, tool name, validated arguments and bounded result/error.
2. Make command construction, process ownership and parsing separate responsibilities; mark unavailable features explicitly. The adapter owns transport to host-tool callbacks; later delegation/memory modules register tool implementations without patching six protocols.
3. Build a fixture adapter emitting ordered text/tool/status events, malformed output, pauses and failures. Exercise a synthetic host-tool request/result round trip with actor binding, duplicate invocation handling and cancellation.

## Acceptance criteria

- [x] One fixture contract covers start, event stream, host-tool request/result, cancel, terminal outcome and capability discovery without secret values in results.
- [x] Unsupported resume/model/tool behaviors are explicit and never emulated as successful execution.
- [x] Malformed or out-of-order adapter output produces a bounded diagnostic rather than corrupting another run.

## Verification

Proposed command: `bun test apps/server/src/modules/runtime/harness.test.ts`. Replay success, host-tool request/result, forged/duplicate invocation, cancellation, malformed event, unknown capability and terminal-once fixtures.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [x] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied for this pure scope.
- [x] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Production must never select the explicit fixture as a real adapter.
- [x] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Accepted by the coordinator after independent WATCH/APPROVE review with no blocker. The assignment accepted RFC-002's supported research/design prerequisite for this pure contract only and RFC-003's native Bun test seam. No operational harness readiness is claimed.

Final-source acceptance supersedes the historical40-test checkpoint below: [006a](006a-preserve-uncertain-tool-failures.md) reproduces and corrects callback-effect errors misclassified as known denial. Only private genuine-tool JSON/schema rejection before callback entry is known no-effect denial; callback/result/custom-tool failures remain uncertain. Coordinator and reviewer independently observed47 tests/112 assertions, strict diagnostics, native callback13/13 and original fixture8/8 checks, all exit0. host-tools.ts SHA256 `356837ef7a06ed890d66f1837a223e420af0324708731519b52f6b0cabd9751a`; harness.test.ts SHA256 `59d4d0f6d72cbda060e64c5a28634ef73f4472a4660f94b807fb7f0a89f94981`. [Review](../docs/verification/reviews/runtime-006-review.md) retains nonblocking test-file organization debt and native/operational limits. RFC009 durable-run design may proceed; RFC008 still requires connection integration.

Changed paths: `apps/server/src/modules/runtime/harness.ts`, `host-tools.ts`, `fixture-adapter.ts`, `harness.test.ts`, `fixture-run.ts`, this completion record, and scoped `local evidence` artifacts (also copied into the active attempt's `runtime-006` directory). No production composition, schema, routes, manifest, dependency, native process adapter or installation changed. No staging/commits/worktrees.

Exported contract:

- `harness.ts`: `runContextSchema`, `RunContext`, `RunInput`, `HarnessCapabilities`, `HarnessErrorCode`, `HarnessError`, `parseRunInput`, `parseCapabilities`, `TerminalOutcome`, `EventPayload`, `HarnessEvent`, `HarnessRun`, `HarnessAdapter<Tool>`, `assertNever`. Version 1 capabilities identify the six researched harnesses or the explicit synthetic fixture. Resume, model selection/catalog and host tools have explicit supported/unsupported states. Input carries frozen branded actor/run/attempt/bot/conversation/configuration identity, optional routine/delegation identity, opaque actor-owned connection/session references and finite deadline/event/output/tool budgets. Strict parsing rejects extra secret fields, foreign references and nonfinite budgets. Parsing is not authentication: the trusted consumer must derive and reauthorize identities/resources first.
- `host-tools.ts`: `HostInvocation`, `ToolContext`, `HostTool`, `boundedText`, `defineHostTool`, `createHostToolGate`. A gate belongs to one attempt; its registry is the allowed-tool set. Transport authenticates its attempt channel before preparing requests. Issued objects and actor/run/attempt binding reject foreign/forged calls; invocation IDs are claimed before awaiting an effect, so both pending and completed duplicates fail. JSON arguments/results use installed Zod schemas and UTF-8 byte bounds. Callback errors become fixed bounded codes; uncertain effects never become success. Implementations must reauthorize resource access immediately before effects. Cancellation closes admission and passes an aborted signal; ignoring that signal does not prove effect cancellation.
- `fixture-adapter.ts`: `createFixtureAdapter(frames, pause?)`. Synthetic object frames cover text, tools, pause/release, failure, malformed/order/size rejection, cancellation and exactly one terminal. It implements a single-use, demand-driven async event stream; execution and its finite timer begin on iteration. Consumers must drain the stream, or cancel and close its iterator when abandoning it. Data events reserve two slots for a fixed error and terminal. Output bytes bound data payloads; fixed diagnostic/identity envelope overhead is additional and bounded by the schemas/event ceiling. Command construction, native framing and process ownership are intentionally absent and remain separate adapter/supervisor responsibilities.
- `fixture-run.ts`: `runFixtureVerification`; explicit `import.meta.main` offline Bun entry point, with no work on import. Emits only fixed booleans and a synthetic scope label.

Acceptance evidence (2026-10-22, Bun 1.3.14, installed Zod 4.6.7):

1. `bun --no-env-file test apps/server/src/modules/runtime/harness.test.ts`: **40 pass, 0 fail, 88 assertions**, exit 0 (`tests.log`). Covers ordered start/text/tool request/result, capability discovery and unsupported model/resume, frozen input and secret-field rejection, foreign actor/run/attempt, A/B issued-callback substitution, structural forgery, duplicate pending/completed calls, call budgets, cancellation before/during callback and after completion, pause/release/deadline, malformed/out-of-order/oversized output, unknown capability, Unicode byte bounds and one terminal. Initial RED was the missing contract module (`red.log`); implementation checkpoint reached 2, then 33, then 38, then 40 passing tests. Initial strict diagnostics found two missing explicit parameter types, a branded-ID assertion and a manual runner narrowing error; all were fixed before final full focused verification.
2. `bun --no-env-file run apps/server/src/modules/runtime/fixture-run.ts`: exit 0; `fixture-run.json` records `ordered`, `roundTrip`, `success`, `terminalOnce`, `foreignDenied`, `orderRejected`, `cancelled`, `cleanup` all true. This is actual native Bun stdout from the synthetic adapter, not native harness/provider proof. All generators/callbacks in this runner settle; completion aborts their signal and clears the timer. No files/processes/network resources are created by the runner.
3. `bun --no-env-file run local evidence`: `import-check.json` reports four modules imported with throwing network/listener/process/timer/write guards. No hidden infrastructure startup on import was observed. The guard is a focused import check, not general OS containment.
4. Strict no-emit invocation and clean `exit=0` receipt are recorded in `report.md`/`types.log`. Source LSP scanned five TypeScript files with zero diagnostics (`lsp.json`). A subsequent artifact-JSON hook reported Biome unavailable; no install was attempted. Source SHA256 values are in `source-sha256.txt`.

Failure/privacy limits and next consumers: fixed errors exclude thrown callback details and raw malformed output; text/tool results remain private untrusted content and must not be logged as diagnostics. The fixture uses object frames, so native partial/malformed UTF-8 and LF/CRLF framing remain each real parser's acceptance work; U+2028/U+2029 payload preservation and UTF-8 size accounting are covered here. The in-memory gate prevents replay only during this process lifetime; RFC-008/010 must persist invocation/attempt uncertainty before effects and reconcile rather than replay after restart. The fixture cannot terminate an uncooperative callback or prove OS process-tree cleanup. RFC-007 owns credential resolution, RFC-008/010 supervisor/recovery/egress, RFC-012–018 pinned native protocol/host-tool/session/model/login/cancel proofs. Resume consumers must additionally bind the opaque stored session to their harness and authorized lease. Browser/desktop proofs remain RFC-074–078. Production imports must select a real accepted adapter, never use fixture success as readiness or onboarding satisfaction. No database, real CLI/provider, network, browser, build, broad suite or deployment was run for this pure slice.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Unchanged. Product path uses text-protocol host tools instead of the fixture adapter contract.

Evidence: docs/decisions/harness-compatibility.md (amendment).

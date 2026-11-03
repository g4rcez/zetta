# RFC-006a: Preserve uncertain tool failures

- **Parent:** [RFC-006](006-define-harness-contract-and-fixture-adapter.md)
- **Status:** Done for callback outcome classification; coordinator accepted independent WATCH/APPROVE review with no blocker.
- **Scope:** Callback outcome classification in host-tools.ts and its existing focused test file.

## Problem and contract

A callback can perform an effect then throw public HarnessError("tool_denied"). The previous gate treated that code as proof of pre-effect denial and cleared uncertainty. Nested validation failures forwarded by callbacks have the same problem.

Only JSON/schema rejection before callback entry in defineHostTool can report known tool_denied. Every failure after callback entry reports outcome_uncertain. A custom HostTool's error code, including a forwarded nested validation error, cannot certify that no effect occurred.

## Completion record

Approval: coordinator's explicit RFC-006 bug-fix assignment under the user's continued-v1 authorization. No new infrastructure or public API was needed.

Changed paths: `apps/server/src/modules/runtime/host-tools.ts`, `apps/server/src/modules/runtime/harness.test.ts`, this child RFC, and unique attempt evidence. The parent RFC and root index are left to the coordinator.

Implementation: private InvalidToolArguments plus private defineHostTool membership distinguish the validation boundary. The callback/result phase converts every thrown error to fixed outcome_uncertain. Exported names and signatures remain HostInvocation, ToolContext, HostTool, boundedText, defineHostTool, createHostToolGate. Duplicate/forged/foreign/cancellation behavior and the existing capability test correction are preserved.

Evidence: complete scenario matrix, commands, source hashes and cleanup.

- Failing first: 42 pass / 4 fail / 100 assertions. Captured pre-fix native counterexample confirms one effect followed by tool_denied and isUncertain false.
- Final focused command: `bun --no-env-file test apps/server/src/modules/runtime/harness.test.ts`; 47 pass / 0 fail / 112 assertions.
- Strict no-emit diagnostics pass; source LSP scans five files with zero diagnostics.
- Native callback driver passes all 13 checks; existing native fixture-run passes all 8 checks. Invalid JSON/schema produce no effects and remain known denial. Direct/nested/custom failures remain uncertain; fixture emits one uncertain terminal and no tool result.
- host-tools.ts SHA256: `356837ef7a06ed890d66f1837a223e420af0324708731519b52f6b0cabd9751a`.
- harness.test.ts SHA256: `59d4d0f6d72cbda060e64c5a28634ef73f4472a4660f94b807fb7f0a89f94981`.

Validation limits: the optional skill checker requires absent TypeScript 7 unstable APIs, while this project has TypeScript 6.0.3; its failure is recorded, with no install. Biome is unavailable for the JSON artifact hook; runtime-source LSP passed. The test file is 293 pure LOC; the assigned two-product-file scope takes precedence over a separate test split. No skipped check is called passing.

Cleanup: synthetic counters only; callbacks settle, iterators drain, callback signals abort and fixture timers clear. No real tool/provider/account/database/server/browser/process side effect was invoked. The fix prevents in-process misclassification; durable uncertainty and no-blind-replay recovery remain RFC-008/010 responsibilities. Next consumer: coordinator reproduces and reviews these exact source hashes before accepting RFC-006.

# RFC execution contract

Use [TASKS.md](../TASKS.md) to select one ready task. Do not implement the whole backlog in one session.

## Required input for a small-model worker

Read this file, [plan.md](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), the assigned RFC, and the handoffs of its direct prerequisites. Read only the relevant source anchors and applicable repository instructions. Planned paths in an RFC do not mean those files exist yet.

A task is ready only when all dependency tasks are accepted, required decisions are recorded, and the owner has approved any schema, auth, route/API, dependency or environment change needed for implementation. A planned RFC is not that approval. Research can finish with documented blockers, but dependent implementation stays blocked until those blockers are resolved.

## Execution rules

1. Inspect current files and Git status. Preserve others' edits. Confirm installed versions from manifests and lockfile; do not assume the skill's latest version matches this repo.
2. Restate the narrow task and list exact paths to change. Target one focused session and about 2–5 product files plus tests/migration output. Split an oversized RFC into linked child documents (for example 004a, 004b) before assigning more work. Keep the parent root-index row authoritative and incomplete until all integrated acceptance criteria pass; children record contracts/evidence, not a second global status tracker. Proceed under recorded approvals without asking again for the same scope; genuinely new decisions and explicitly gated environment actions still require approval.
3. Check prerequisite handoffs for contracts. Do not invent a provider endpoint, CLI flag, schema, public route, or permission rule. Missing contract or conflicting behavior means stop and ask.
4. Implement the smallest complete slice with its focused tests. Reuse existing platform/dependencies. Do not add scaffolding for future features.
5. Run only the RFC's approved focused checks. A native `bun test <file>` is the proposed test approach after RFC-003. Do not run an unbounded `bun test`, build, E2E, paid service, migration, container stack or real account check without approval. No install commands.
6. Review security, failure handling, cancellation and privacy for the slice. Use LSP diagnostics if available; state if unavailable. Do not use the root `check` script as a read-only check: it formats files. Web `check-types` includes a build.
7. Write a handoff in this RFC's `## Completion record` and update its row in root `TASKS.md` only when work status actually changes. No automatic commits, staging, branches, worktrees or deployments.

## Shared definition of done

All RFCs inherit these conditions, in addition to their own task-specific definition:

- Every acceptance criterion has evidence: focused test result, fixture assertion, reviewed decision artifact, or explicitly approved manual check.
- Negative and cross-owner cases are covered where the feature handles scoped data. A UI-only check is not authorization evidence.
- No secret values, account tokens, private content, or host paths are logged or checked into fixtures. Use synthetic users and sources.
- Tests and diagnostics for changed code are recorded with exact commands and results; skipped checks and their reason are explicit.
- Only approved paths changed. Generated files use their generator. Dependency/lockfile and schema changes have the required approval and review.
- User-visible errors use plain language and offer an authorized repair-and-return path without losing completed work. Async resources have cleanup; external effects are not blindly retried.
- User-facing changes preserve shared form/chat validation, source-linked attention semantics and visual-only workspace grouping. Onboarding requires actual harness conversation and explicit positive satisfaction, scoped to the actor/bot/tested setup; fixture success alone is not readiness.
- Each connected journey records its input contract, result/next-action link and downstream consumer. State what the user can do next; do not count an isolated settings form as a complete workflow.
- Contracts, unresolved risks and the next consumer's entry point are recorded. A blocker is never described as complete.

Research RFCs must distinguish observed facts, proposed design, and unresolved questions. Record upstream URL/version/access date when citing external evidence. Research does not authorize downloads, paid calls, executing arbitrary third-party tools, or installing dependencies.

## Standard handoff format

Fill the assigned RFC's completion record:

- Status: proposed / blocked / ready / in progress / review / done.
- Approval/decision references and prerequisite handoffs used.
- Changed paths and concrete contract exported.
- Acceptance evidence, exact commands, diagnostics, skipped checks.
- Failure/recovery behavior and remaining risks.
- Next task(s) unblocked; stop conditions for their worker.

## Parallel work

Only independent ready RFCs may run concurrently. Harness adapters can run separately once their contract and supervisor are accepted. Jev and Laya research can run separately. Do not concurrently modify shared server composition, schema index, migrations, route generation, manifests, or shared UI tokens. Assign one owner for those paths and serialize integration. Separate worktrees require explicit user approval.

## Task and checkpoint status

The root index is the single task status source. RFC completion records contain evidence, not a second checklist of global status. Checkpoint gates do not imply permission to run a full suite. At each gate, review the last 2–3 handoffs and the named focused fixture outcomes before assigning more work. Release validation includes approved real harness, browser and computer-use checks, plus visual workflows and the connected journeys in RFC-067—not just fixtures. The earlier deferral of workflows/browser/computer use is superseded; only their concrete backend/API choices remain gated.

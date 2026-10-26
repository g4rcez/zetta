# RFC-066: Verify cross-user isolation end to end

- **Module:** Operations and release
- **Status:** Review; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-013](013-implement-pi-execution-adapter.md), [RFC-014](014-implement-codex-execution-adapter.md), [RFC-015](015-implement-omp-execution-adapter.md), [RFC-016](016-implement-claude-code-execution-adapter.md), [RFC-017](017-implement-opencode-execution-adapter.md), [RFC-018](018-implement-cursor-execution-adapter.md), [RFC-035](035-build-team-read-only-snapshot-viewer.md), [RFC-037](037-aggregate-bounded-specialist-work.md), [RFC-044](044-configure-bot-integration-bindings.md), [RFC-053](053-configure-and-inspect-bot-hooks.md), [RFC-058](058-inspect-correct-and-forget-memories.md), [RFC-060](060-resolve-instruction-and-skill-context.md), [RFC-063](063-apply-only-explicitly-approved-versions.md), [RFC-064](064-add-privacy-safe-execution-audit-views.md), [RFC-072](072-build-user-attention-kanban.md), [RFC-073](073-configure-resources-through-any-bot-chat.md), [RFC-078](078-provide-secure-takeover-and-hand-back.md), [RFC-080](080-execute-durable-workflow-steps.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Prove the assembled features preserve the same user boundary across every execution path.

## Non-goals

No attack on real accounts/production systems or treating frontend hiding as security evidence.

## Source anchors and planned changes

- `apps/server/src/test-support/isolation-matrix.test.ts (new)`
- `docs/verification/isolation.md`

## Contract and implementation steps

1. Build synthetic A/B/admin/team fixtures with shared/private bots, private chiefs, account bindings, files, memories and published snapshots.
2. Trace forged IDs and source injection through chat, mentions, delegation, schedules, decisions, hooks, learning, any-bot configuration and workflow nodes. Include A-onboarded/B-unready, forged satisfaction, workspace moves and private kanban/result links.
3. Run approved real isolation probes for each harness, browser profiles and computer sessions, including same-user profile sharing, cross-user rejection, takeover links, clipboard/screen secrecy and native memory. Verify published workflow execution preserves the initiating actor. Retain only redacted evidence.

## Acceptance criteria

- [ ] Every access-matrix row in RFC-001 has a passing allow/deny assertion or an explicit release blocker.
- [ ] Delegation/hooks/schedules preserve initiator identity; no shared bot exposes another user's account, files or learned context.
- [ ] Snapshot/kanban viewers cannot gain live-resource authority; native CLI, browser/profile, desktop/takeover and workflow isolation is proved beyond mocks. Acknowledgment, workspace moves and another user's onboarding cannot grant access or mark work successful.

## Verification

Proposed command: `bun test apps/server/src/test-support/isolation-matrix.test.ts`. Browser/subprocess/database/provider probes require explicit approval and separate evidence; unrun probes cannot count as pass.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Export the described module behavior with focused tests and a short contract handoff for dependent RFCs. Do not leave mock success paths in production code.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Not started. The implementing worker records approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Review.** Cross-user matrix passes for every product resource. Native-process isolation remains unproven (see RFC-002/008).

Evidence: docs/verification/isolation.md.

## Completion update (2026-10-23)

**Status: Review.** Product-level matrix covers every resource, now including memory stores (user profile shared by a user's bots, per-bot notes) and email/X source connections. Remaining: first Linux/Windows CI run (RFC-008).

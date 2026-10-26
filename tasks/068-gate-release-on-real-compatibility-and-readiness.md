# RFC-068: Gate release on real compatibility and readiness

- **Module:** Operations and release
- **Status:** Blocked; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-013](013-implement-pi-execution-adapter.md), [RFC-014](014-implement-codex-execution-adapter.md), [RFC-015](015-implement-omp-execution-adapter.md), [RFC-016](016-implement-claude-code-execution-adapter.md), [RFC-017](017-implement-opencode-execution-adapter.md), [RFC-018](018-implement-cursor-execution-adapter.md), [RFC-047](047-implement-jev-decision-adapter.md), [RFC-049](049-implement-laya-decision-adapter.md), [RFC-065](065-document-and-verify-recovery-boundaries.md), [RFC-066](066-verify-cross-user-isolation-end-to-end.md), [RFC-067](067-verify-representative-v1-user-workflows.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Assemble evidence that v1 is ready without declaring success for mocked or blocked integrations.

## Non-goals

No deployment, paid model calls, broad build/test execution or scope cuts without user approval.

## Source anchors and planned changes

- `docs/verification/release-readiness.md`
- `TASKS.md`
- `tasks/plan.md`

## Contract and implementation steps

1. Collect exact supported versions and real evidence for all six harnesses, both decision providers, Hermes memory, sources, browser automation and computer use. Verify visual workflow execution/editor and secure takeover; browser-only or fixture-only evidence cannot satisfy both execution modes.
2. Review locally enforced auth/isolation, migration/rollback, restart, accessibility and retention with the owner. Require completed real-conversation+satisfaction onboarding, form/non-chief-chat configuration parity, attention kanban, repair-and-return and task→learning→routine journeys from RFC-067.
3. Request approval for any remaining build/full-suite/E2E/real-provider checks and document pass/fail/not-run separately; issue go/no-go recommendation, not a deploy.

## Acceptance criteria

- [ ] Every required integration has real evidence, including browser and computer use; visual workflows and the approved management journeys pass. Missing capability, unrun isolation proof or fixture-only onboarding yields no-go.
- [ ] All RFC acceptance gaps and skipped checks are visible with ownership; no blocked work is marked complete to meet a date.
- [ ] Owner receives a release checklist, supported environment/version matrix and recovery references with no unapproved deployment performed.

## Verification

Document review of all prerequisite completion records plus only explicitly authorized release checks. There is no generic command that substitutes for real compatibility evidence.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Accepted artifact: `docs/verification/release-readiness.md`. Cite evidence and owner approval; unresolved decisions keep dependent implementation blocked.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Not started. The implementing worker records approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Blocked.** Release gate evaluated: NO-GO against the RFC's own rule (real compatibility incomplete: 5 of 6 harnesses and Jev not live, native isolation, desktop use, restore drill). Conditional go only for a trusted-team install.

Evidence: docs/release/release-readiness.md.

## Completion update (2026-10-23)

**Status: Blocked** (unchanged). Re-evaluated against owner directions: see docs/release/release-readiness.md > "Gate re-evaluation". Conditional GO for a trusted-team install; open items are CI on Linux/Windows, remaining review fixes, and live checks of Email/X and non-Claude harnesses.

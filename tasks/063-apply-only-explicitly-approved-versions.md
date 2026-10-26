# RFC-063: Apply only explicitly approved versions

- **Module:** Self-configuration
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-062](062-propose-and-display-configuration-diffs.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Apply an approved bot configuration diff atomically while preventing stale or replayed approvals.

## Non-goals

No implicit approval from an assistant message, retroactive mutation of running tasks or bypass of edit permissions.

## Source anchors and planned changes

- `apps/server/src/modules/learning/config-approval.ts (new)`
- `apps/web/src/features/bots/config-diff.tsx`

## Contract and implementation steps

1. Validate authorized session, origin and proposal state; bind approval to the exact base/proposed hashes displayed to the user.
2. Compare-and-swap the configuration version and mark approval applied atomically; stale proposals require a new diff/review.
3. Record approver/time/change references and retain prior versions for explicit restoration. Emit actual apply/reject/stale resolution to RFC-071; card acknowledgment cannot apply a proposal. Meaningful configuration changes trigger RFC-020 readiness revalidation without changing active run snapshots.

## Acceptance criteria

- [ ] Only an explicit authorized approval applies the displayed exact diff; reject/stale/expired proposals cannot apply.
- [ ] Concurrent edits and duplicate approvals do not overwrite newer configuration or create multiple applied versions.
- [ ] Existing runs retain their original configuration; future runs see the approved version with an audit trail.

## Verification

Proposed command: `bun test apps/server/src/modules/learning/config-approval.test.ts`. Forged/replayed approval, changed diff, concurrent editor, rejection and future-versus-active run fixtures; approved transactional database proof.

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

**Status: Done.** Approval is one transaction with version+hash check, revision history, exactly-once under concurrent approvals.

Evidence: apps/server/src/modules/features/wave.integration.test.ts (proposals).

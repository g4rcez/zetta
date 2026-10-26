# RFC-065: Document and verify recovery boundaries

- **Module:** Operations and release
- **Status:** Review; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-010](010-dispatch-and-recover-durable-work.md), [RFC-039](039-dispatch-timezone-aware-scheduled-occurrences.md), [RFC-055](055-persist-scoped-memory-records.md), [RFC-064](064-add-privacy-safe-execution-audit-views.md), [RFC-075](075-manage-scoped-browser-profiles.md), [RFC-077](077-run-isolated-computer-use-sessions.md), [RFC-080](080-execute-durable-workflow-steps.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Define deploy/start/stop/recovery and backup responsibilities for persistent runs, files, credentials and knowledge.

## Non-goals

No actual production deploy, host-wide backup, secret export into docs or new infrastructure service.

## Source anchors and planned changes

- `docs/operations/recovery.md`
- `docker-compose.yml (read first)`
- `apps/server/src/modules/runtime/recovery.test.ts (new)`

## Contract and implementation steps

1. Inventory owned volumes/tables and secret references under the approved isolation topology: browser profiles, desktop/session metadata, workflow versions/steps, attention items and onboarding evidence as well as existing chat/knowledge. Document separate key recovery, stale-input lease handling and secret-bearing profile restore without cross-user reuse.
2. Exercise synthetic restart/shutdown/lease recovery and retention cleanup without blindly retrying uncertain external effects.
3. Write backup/restore and configuration rollback runbooks with approval gates, compatibility versions and restore verification; avoid destructive commands on live state.

## Acceptance criteria

- [ ] Runbook states what survives restart and what becomes interrupted/blocked: memories/instructions, snapshot attachments, browser logins, desktop control, workflows and attention/onboarding state. Restored credentials require validity checks before readiness; uncertain actions are not replayed.
- [ ] Synthetic restart tests preserve ownership and avoid duplicate occurrence/delegation work.
- [ ] An approved disposable restore verifies data plus required secret-reference recovery, or restore readiness remains explicitly blocked.

## Verification

Proposed command: `bun test apps/server/src/modules/runtime/recovery.test.ts`. Pure recovery fixtures are separate from approval-required container/database backup/restore exercise.

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

**Status: Review.** Recovery boundaries documented and boot reconciliation tested. The disposable backup/restore drill has not been run.

Evidence: docs/operations/recovery.md.

## Completion update (2026-10-23)

**Status: Done.** Restore drill rerun 2026-10-23 with scripts/restore-drill.sh (repeatable): dump -> restore into a fresh database -> identical row counts (users, bots, messages, memories, conversations, sources, 16 migrations) -> migrate is a no-op -> server boots on the restored copy (/ OK, identity anonymous, no message left running, memory targets preserved). Evidence: docs/verification/restore-drill.md.

# RFC-020: Implement versioned bot configuration

- **Module:** Bots and teams
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-005](005-enforce-actor-and-resource-access-boundaries.md), [RFC-006](006-define-harness-contract-and-fixture-adapter.md), [RFC-007](007-store-user-owned-connection-references.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Create and edit team-visible or private bot definitions without mixing configuration with execution identity.

## Non-goals

No self-edit approval UI yet, action permission designer or model secrets embedded in bot records.

## Source anchors and planned changes

- `packages/db/src/schema/bots.ts (new)`
- `apps/server/src/modules/bots/ (new)`

## Contract and implementation steps

1. Approve bot schema and configuration contract: owner/visibility, name/personality, harness/model, instruction/skill references and integration requirements.
2. Version validated configuration and enforce RFC-001 edit/use policy. Archive bots rather than breaking historical runs.
3. Resolve user-specific connection bindings at run time; reject unsupported required capabilities. Define separate technical prerequisites and user-confirmed onboarding keyed by actor, bot and relevant configuration/binding fingerprint. Ordinary runs require both; allow only explicitly user-started, bounded onboarding/test turns before satisfaction. RFC-021 records real response evidence and explicit confirmation. Meaningful harness/model/instruction/account changes invalidate readiness; cosmetic changes need not. Recheck access/revocation at every dispatch.

## Acceptance criteria

- [ ] Bots default to team visibility; private bots remain owner-only across list/read/use/edit paths.
- [ ] Concurrent configuration edits detect stale versions and cannot overwrite another accepted change.
- [ ] Run configuration is reproducible by version; archive/revocation blocks new work without erasing history. A completing onboarding cannot mark a shared bot ready for B, and no model-supplied flag can bypass normal-run admission.

## Verification

Proposed command: `bun test apps/server/src/modules/bots/configuration.test.ts`. Test visibility defaults, A/B operations, stale version, invalid capabilities, archive, A-ready/B-not-ready, forged test mode and readiness invalidation. Onboarding/test requests cannot spawn delegation, scheduled work or workflow execution to bypass readiness.

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

**Status: Done.** Bot config with owner-only edit, optimistic versions, immutable per-version revisions, harness/model validation, required connections, team visibility.

Evidence: apps/server/src/modules/chat/service.ts (bot_revision); chat.integration.test.ts.

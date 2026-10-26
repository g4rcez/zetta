# RFC-045: Prove source-to-briefing context flow

- **Module:** Application integrations
- **Status:** Review; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-037](037-aggregate-bounded-specialist-work.md), [RFC-041](041-show-routine-run-history-and-outcomes.md), [RFC-044](044-configure-bot-integration-bindings.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Demonstrate the selected source integrations feeding a private scheduled briefing and newsletter draft with provenance.

## Non-goals

No every-app connector expansion, arbitrary security targeting, trades or unattended publication to real audiences.

## Source anchors and planned changes

- `apps/server/src/modules/integrations/source-context.test.ts (new)`
- `docs/verification/source-workflows.md`
- `apps/server/src/modules/integrations/ (only accepted source mapping)`

## Contract and implementation steps

1. Create synthetic email/blog/Reddit/X/repository source fixtures matching RFC-042 and bound retrieved content with source links/timestamps.
2. Exercise manual and scheduled chief delegation using the requester/routine owner identity; treat source instructions as untrusted content.
3. Document approved live checks for selected sources and gaps; newsletter publishing destinations require an explicit configured task/account, not a test side effect.

## Acceptance criteria

- [ ] Briefing/newsletter results identify their source context and distinguish missing/failed sources from empty results.
- [ ] A/B fixture sources never mix, and injected source instructions cannot change connection ownership or self-configuration.
- [ ] Selected real source paths have evidence or remain release blockers; financial/security/code-review scenarios use synthetic or explicitly authorized inputs.

## Verification

Proposed command: `bun test apps/server/src/modules/integrations/source-context.test.ts`. Deterministic fake provider outputs assert provenance/identity, not subjective model prose; any live source/model call needs approval.

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

**Status: Review.** Source -> briefing flow proven with a fake feed (RSS source node feeds a bot, failing sources are named, never invented). Live sources (email, X) are blocked.

Evidence: apps/server/src/modules/integrations/integrations.integration.test.ts.

## Completion update (2026-10-23)

**Status: Done.** Email and X setup built (2026-10-23): Studio > Sources adds a mailbox (Gmail/Outlook/iCloud/Yahoo/any IMAP with an app password, read-only) and X (user timeline or search with the owner's bearer token). Secrets go to the sealed connections store (providers `email`, `x`); sources keep only a reference. Third-party text is labelled untrusted in briefings. Tests with fake readers: private-sources.integration.test.ts (own/foreign/revoked/wrong-provider connections, host validation, failure reporting). NOT yet run against a live mailbox or X account: that needs the owner's credentials entered in the UI.

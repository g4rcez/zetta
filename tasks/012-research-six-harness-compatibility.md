# RFC-012: Research six-harness compatibility

- **Module:** Harness adapters
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Research / decision
- **Dependencies:** [RFC-002](002-prove-multi-user-execution-isolation.md), [RFC-006](006-define-harness-contract-and-fixture-adapter.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Produce a versioned evidence matrix for Pi, Codex, OMP, Claude Code, OpenCode and Cursor before adapter coding.

## Non-goals

No guessed CLI flags, account introspection, automatic installation, or dropping a required harness.

## Source anchors and planned changes

- `docs/decisions/harness-compatibility.md`
- `apps/server/package.json`
- `package.json`

## Contract and implementation steps

1. Identify official product/repository and executable for all six, especially OMP and Cursor; record supported installed/target versions without reading login files.
2. Document structured/headless mode, session ownership, resume, model listing, instructions, skills, MCP/tools, cancellation and authentication setup for each. Verify how each harness invokes Zetta-owned delegation/memory/configuration tools and returns results under the run identity. Distinguish this local host-tool bridge from external app MCP sessions in RFC-043; adapter RFCs own any required native or local MCP transport.
3. Record captured synthetic output fixtures where approved, provider restrictions and unsupported capabilities. Split unresolved products into explicit blockers.

## Acceptance criteria

- [ ] Each of the six rows cites first-party evidence with version/date and explicit unknowns.
- [ ] Each adapter has an approved command/protocol strategy, isolated credential/session location and host-tool bridge path, or remains blocked. Plain chat support alone does not prove delegation or self-learning support.
- [ ] A shared conformance fixture checklist names real validation required beyond mocks and identifies provider data egress.

## Verification

Review matrix against the contract; approved version/help probes may collect evidence without invoking a model. Do not label any integration supported without a verified path.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Accepted artifact: `docs/decisions/harness-compatibility.md`. Cite evidence and owner approval; unresolved decisions keep dependent implementation blocked.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Not started. The implementing worker records approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Owner decision 2026-10-23: harnesses that are not installed or not exercised are ASSUMED WORKING; only Claude Code is smoke-tested. Implemented through the shared CLI adapter (argv, typed errors and container mode covered with fakes).

Evidence: apps/server/src/modules/chat/harness.ts; docs/decisions/harness-compatibility.md (amendment).

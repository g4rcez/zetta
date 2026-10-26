# RFC-048: Identify and verify Laya integration

- **Module:** Decisions
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Research / decision
- **Dependencies:** [RFC-007](007-store-user-owned-connection-references.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Establish the exact Laya product, supported protocol and data handling before designing its adapter.

## Non-goals

No guessed endpoint/SDK, substitution with a generic LLM or unapproved transmission of user content.

## Source anchors and planned changes

- `docs/decisions/laya.md`
- `readme.md`
- `apps/server/src/modules/connections/`

## Contract and implementation steps

1. Identify the intended upstream Laya from owner-provided or first-party evidence; ask if identity is ambiguous.
2. Record version/license, authentication ownership, request/result schema, limits, timeout/cancel behavior and data retention/egress.
3. Define typed fixtures for decisions, malformed/uncertain results and safe fallback. Document whether thresholds/action labels are provider concepts or Zetta configuration.

## Acceptance criteria

- [ ] Laya is identified by authoritative source and concrete supported integration method; absence remains a blocker.
- [ ] Owner accepts transmitted data and account scope, with no assumption that all private chat history is sent.
- [ ] A fixture contract and failure policy are recorded without claiming real integration success.

## Verification

Source-backed document review; validate synthetic request/response examples against published schemas. Live calls require explicit approval.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Accepted artifact: `docs/decisions/laya.md`. Cite evidence and owner approval; unresolved decisions keep dependent implementation blocked.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Not started. The implementing worker records approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Runtime choice recorded (@receptron/laya ONNX in-process).

Evidence: docs/decisions/laya.md.

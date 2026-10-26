# RFC-042: Approve MCP and source connection contract

- **Module:** Application integrations
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Research / decision
- **Dependencies:** [RFC-007](007-store-user-owned-connection-references.md), [RFC-012](012-research-six-harness-compatibility.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Define a minimal user-owned integration path and select real source coverage for v1 acceptance without building a marketplace.

## Non-goals

No OAuth scope approval by implication, bespoke connector for every README app or unverified MCP interoperability claim.

## Source anchors and planned changes

- `docs/decisions/app-integrations.md`
- `apps/server/src/modules/connections/`
- `readme.md`

## Contract and implementation steps

1. Review candidate MCP servers/installed CLI integrations by purpose, permissions, transport, OAuth scopes, license and credential isolation.
2. Select supported transports and initial source access for email newsletters, blogs, Reddit, X and repository research; record provider limitations and approved source-specific fallback/manual import. A manual import does not satisfy required browser/computer execution.
3. Browser/computer use is required in v1. Coordinate source handoff and login needs with RFC-074–078; those RFCs own backend choice, isolated profiles/desktops and secure takeover. Decide how sources use those capabilities, not whether to deliver them.

## Acceptance criteria

- [ ] Each required acceptance source has an approved real connection path or a visible blocker, not fabricated API behavior.
- [ ] The decision specifies per-user binding, network/SSRF policy, local-process containment, secret injection and revoke semantics.
- [ ] Initial source coverage and browser/computer handoff contracts are explicit; both required execution modes remain release gates. Marketplace and unrelated bespoke connectors remain excluded.

## Verification

Review transport/account matrix with two users and a shared bot; verify official integration documentation only until live service approval.

Use synthetic data. Run each new or changed focused test once it exists. Environment-dependent checks need separate approval. Record exact outcomes and do not turn skipped checks into passing evidence.

## Definition of done

- [ ] All three task acceptance criteria have recorded evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Accepted artifact: `docs/decisions/app-integrations.md`. Cite evidence and owner approval; unresolved decisions keep dependent implementation blocked.
- [ ] Failure/privacy behavior, exact validation, changed paths and remaining blockers are recorded below; the coordinator can safely assign the next dependent task.

## Small-model handoff and stop rules

Implement only this RFC after prerequisites and required approvals are accepted. Reuse prerequisite contracts rather than redesigning adjacent modules. If evidence contradicts the plan, an API is undocumented, or a new dependency/security boundary is required, stop and give the coordinator the smallest concrete decision needed. Do not expand scope or mark a fixture as real compatibility proof.

## Completion record

Not started. The implementing worker records approvals, changed paths, exported contracts, acceptance evidence, exact commands/diagnostics, skipped checks, remaining risks and newly unblocked RFCs here.

## Completion record (2026-10-23, simplified v1 path)

**Status: Done.** Decision recorded: MCP SDK over HTTP/allowlisted stdio, per-user binding, SSRF policy, secret injection, revoke; email/X sources are visible BLOCKED-EXTERNAL gaps.

Evidence: docs/decisions/app-integrations.md.

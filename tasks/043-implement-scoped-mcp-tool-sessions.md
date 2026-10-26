# RFC-043: Implement scoped MCP tool sessions

- **Module:** Application integrations
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-008](008-implement-isolated-process-supervision.md), [RFC-042](042-approve-mcp-and-source-connection-contract.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Open approved MCP connections for one run and expose only the initiating user's assigned tools.

## Non-goals

No arbitrary shell commands from chat, ambient server credentials, unrestricted URL fetches or silent tool-name collisions.

## Source anchors and planned changes

- `apps/server/src/modules/integrations/mcp-session.ts (new)`
- `apps/server/src/modules/integrations/tool-registry.ts (new)`

## Contract and implementation steps

1. Use an existing approved implementation if available; otherwise request dependency approval. Support only RFC-042 transports.
2. Resolve per-user credentials, validate endpoints/process specs and bound handshake/tool output/time; use qualified tool identities.
3. Close sessions on cancellation/completion/revocation and redact sensitive errors; expose tool results as untrusted content.

## Acceptance criteria

- [ ] A shared bot's A run cannot enumerate or invoke B tools/accounts; credentials do not enter model context.
- [ ] Disallowed endpoint/private-network redirects or executable configurations fail under the accepted network policy.
- [ ] Timeout, malformed tool output, duplicate tool name and disconnected server produce bounded errors with cleanup.

## Verification

Proposed command: `bun test apps/server/src/modules/integrations/mcp-session.test.ts`. Fake server fixtures for A/B, handshake failure, cancellation, output cap and SSRF policy; approved real transport smoke remains required.

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

**Status: Done.** Scoped MCP sessions: per-call or per-turn scopes (stateful servers keep one session for the whole chat turn), deadline, always closed, bound-only access. Verified against a real MCP server over the SDK transport and against the real Chrome DevTools MCP server (chrome-devtools-mcp via npx, real headless Chrome) driven by a bot tool loop.

Evidence: apps/server/src/modules/integrations/mcp.ts; integrations.integration.test.ts; chrome-devtools.integration.test.ts (ZETTA_MCP_CHROME_TEST=1).

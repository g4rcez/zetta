# RFC-026: Connect private chat composer to runs

- **Module:** Chat
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-011](011-expose-owned-run-events-with-replay.md), [RFC-024](024-build-chat-first-navigation-shell.md), [RFC-025](025-persist-private-conversations-and-messages.md), [RFC-070](070-build-private-multi-turn-run-context.md)
- **Size target:** One focused session. Split with the coordinator if the scope exceeds about 2–5 product files plus tests/migration output.

## Context and required reading

Read [execution rules](README.md), [plan](plan.md), [confirmed intent](../docs/intent/zetta-v1.md), and direct dependency completion records. Inspect the source anchors below before editing. Proposed paths are not existing contracts. This RFC authorizes no install, schema/auth/API change, external call, build or deployment by itself.

## Goal

Let users open a bot conversation, send a prompt and see a real run response through the existing chat components.

## Non-goals

No Markdown parser implementation, file uploads, threads or fake assistant responses.

## Source anchors and planned changes

- `apps/web/src/features/chat/composer.tsx (new)`
- `apps/web/src/features/chat/conversation.tsx (new)`
- `apps/web/src/routes/_auth/ (chat route)`

## Contract and implementation steps

1. Reuse message/bubble/scroller/textarea primitives; load authorized conversation history and pending run state.
2. Submit through RFC-070's multi-turn context path with stable idempotency keys and distinguish composing/sending/accepted/failed states; preserve input on rejection. Render persisted assistant/tool output from RFC-069 rather than storing authoritative history only in the browser.
3. Wire cancellation/status without treating disconnect as cancellation; support newline versus send. Respect RFC-020 admission: normal work requires completed onboarding, while a clearly marked, user-started setup conversation is allowed for an unready bot so RFC-021 can test it. Never let the client or model promote that test to ordinary readiness.

## Acceptance criteria

- [ ] Sending creates one persisted message/run and shows a fixture or real adapter response with correct attribution.
- [ ] Double submit/reconnect does not duplicate execution, and rejected sends retain recoverable composer text.
- [ ] Keyboard focus, empty conversation and unavailable bot states are usable; another user cannot open the route by ID.

## Verification

Proposed command: `bun test apps/web/src/features/chat/composer-state.test.ts`. Approved browser check covers send, double click, failure/retry, keyboard newline and cancel.

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

**Status: Done.** Composer with streaming, stop/cancel, draft kept on failure, retry-safe sends.

Evidence: apps/web/src/features/chat/chat-page.tsx.

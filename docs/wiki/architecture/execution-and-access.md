# Execution, access, and recovery

[Wiki home](../README.md) · [System overview](system-overview.md)

> **Status: required invariants and proposed implementation boundaries.** These are not claims that isolation, durability, or compatibility has been proved. Exact contracts belong to the cited RFCs.

## Keep the actor stable

Derive the initiating user from the authenticated session or stored routine owner, not model output or a client-supplied user ID. Carry that identity through the bot, conversation, run, delegation, workflow, hook, decision, and connection resolution. Recheck access at dispatch and when a user opens retained resources.

A chief coordinates; it does not gain extra edit authority. Folders cannot change permissions. Native CLI homes, credentials, memory, processes, browser state, and desktop sessions need an actual isolation boundary. A prompt telling a model not to read another user's data is not one.

Ownership and isolation decisions are assigned to [RFC-001](../../../tasks/001-approve-domain-and-ownership-contracts.md) and [RFC-002](../../../tasks/002-prove-multi-user-execution-isolation.md). Enforcement and connection contracts belong to [RFC-005](../../../tasks/005-enforce-actor-and-resource-access-boundaries.md) and [RFC-007](../../../tasks/007-store-user-owned-connection-references.md).

## Readiness has evidence, not a shared flag

[Bot configuration](../../../tasks/020-implement-versioned-bot-configuration.md) separates technical prerequisites from user-confirmed onboarding. The evidence is tied to the actor, bot, and relevant configuration/account-binding fingerprint:

```text
Technical setup → bounded real setup conversation → satisfaction question
  → explicit positive user confirmation → ordinary-work admission
```

A negative answer returns to refinement. Missing credentials, silence, reactions, stale confirmation, assistant-authored consent, and another user's onboarding cannot satisfy the gate. Meaningful setup changes require revalidation; cosmetic changes need not. The exact meaningful-change rules need an explicit contract, not a wiki guess.

A bounded, user-started setup turn is necessary before readiness. It can support authorized self-refinement but cannot spawn delegation, scheduled work, or workflow execution to bypass the gate. The shell and chat therefore precede completed onboarding in the dependency graph. See [RFC-021](../../../tasks/021-build-bot-onboarding-and-settings.md), [RFC-024](../../../tasks/024-build-chat-first-navigation-shell.md), and [RFC-026](../../../tasks/026-connect-private-chat-composer-to-runs.md).

## Use one mutation path for forms and chat

Record initiating user, proposing bot, target resource, and base version separately. Recheck target edit permission; model-generated text or source content cannot grant it. Show exact proposed changes or a creation summary, then require explicit user approval for bot-proposed mutations. Detect stale versions and duplicate submissions.

Automatic learning is not a prerequisite for user-requested configuration. A self-initiated proposal does not acquire cross-resource authority merely because explicit user-requested assistance can target another resource the user may edit. See [RFC-062](../../../tasks/062-propose-and-display-configuration-diffs.md), [RFC-063](../../../tasks/063-apply-only-explicitly-approved-versions.md), and [RFC-073](../../../tasks/073-configure-resources-through-any-bot-chat.md).

## Durable work is not exactly-once external action

[Run lifecycle](../../../tasks/009-persist-run-lifecycle-and-idempotency.md) and [dispatch/recovery](../../../tasks/010-dispatch-and-recover-durable-work.md) own logical request identity, attempt identity, state, deadlines, cancellation, and recovery. Replayed requests/events must not create duplicate logical jobs. Schedules add occurrence identity; workflow steps retain graph, node, parent, and attempt identity.

Persist completed and uncertain portions. A lost response after an external operation does not prove that the operation failed. Restart, account repair, reconnect, card acknowledgment, or merely opening a result must not cause blind replay. Supported continuation and a new attempt are different choices. Cancellation is not rollback.

Browser/computer takeover also transfers input ownership: suspend automation and sensitive observation before human entry, then explicitly hand back. An expired lease cannot permit two controllers. Required real evidence is assigned to [RFC-074–078 via the integration guide](integrations-and-gates.md).

## Attention is a projection, not another execution engine

[Attention state](../../../tasks/071-define-common-in-app-attention-state.md) uses a stable actor/source/issue-generation identity. Producers from chat, delegation, routines, proposals, browser/computer use, and workflows emit consistent items; sidebar, activity, and [kanban](../../../tasks/072-build-user-attention-kanban.md) consume the same authorized view.

| Operation             | Required meaning                                                        |
| --------------------- | ----------------------------------------------------------------------- |
| Read/acknowledge      | The user has seen the item; no implied approval or completion.          |
| Resolve               | The underlying answer, repair, or decision clears that issue.           |
| Approve configuration | An explicit authorized version-bound decision, not a board movement.    |
| Cancel work           | An explicit request to the execution owner, not deletion of a card.     |
| Show result           | An authorized durable link, with partial/uncertain state still visible. |

Source identity prevents duplicate cards after replay. A new failed routine occurrence must not vanish because an earlier occurrence was acknowledged. Revoked links must fail safely without leaking content.

## Evidence required

Use focused fixtures for state transitions, stale versions, duplicate requests, and A/B access cases. Use approved real runtime probes for process/profile/desktop isolation and harness behavior. [RFC-066](../../../tasks/066-verify-cross-user-isolation-end-to-end.md) owns cross-user evidence; [RFC-067](../../../tasks/067-verify-representative-v1-user-workflows.md) owns connected user journeys. Neither a UI-only test nor a fixture adapter proves the runtime boundary.

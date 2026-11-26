# Execution, access, and recovery

[Wiki home](../README.md) · [System overview](system-overview.md)

The rules the server keeps for every piece of work, whoever or whatever started it.

## The actor stays stable

The initiating user comes from the authenticated session or the stored routine owner, never from model output or a user ID the client sends. That identity is carried through the bot, conversation, run, delegation, workflow, hook, decision, and connection resolution. Access is checked again at dispatch and when a user opens retained resources.

A chief coordinates; it does not gain extra edit authority. Folders cannot change permissions. Native CLI homes, credentials, memory, processes, browser state, and desktop sessions sit behind an actual isolation boundary: a prompt telling a model not to read another user's data is not one. How far that boundary goes on one machine, and what Docker adds, is in [runtime modes](../../operations/runtime-modes.md).

## Readiness is confirmed, not a shared flag

Technical prerequisites and the user's own confirmation are separate. The confirmation is tied to the actor, the bot, and the configuration and account bindings that were tested:

```text
Technical setup → bounded real setup conversation → satisfaction question
  → explicit positive user confirmation → ordinary-work admission
```

A negative answer returns to refinement. Missing credentials, silence, reactions, a stale confirmation, consent written by the assistant, and another user's onboarding cannot satisfy the gate. Changing the agent, the model, the personality or the instructions resets readiness; cosmetic changes do not.

A bounded setup turn, started by the user, comes before readiness. It can support authorized self-refinement but cannot spawn delegation, scheduled work, or workflow execution to bypass the gate.

## One mutation path for forms and chat

The initiating user, the proposing bot, the target resource, and the base version are recorded separately. Edit permission on the target is checked again; text a model generated, or content from a source, cannot grant it. A bot-proposed change shows the exact changes or a creation summary and waits for the user's explicit approval. Stale versions and duplicate submissions are detected.

A proposal a bot makes on its own does not acquire authority over other resources merely because the user could have asked for that change.

## Durable work is not exactly-once external action

Each run has a logical request identity, attempt identity, state, deadlines, cancellation, and recovery. A replayed request or event does not create a duplicate job: a repeated send with the same request id returns the stored turn. Schedules add occurrence identity; workflow steps keep graph, node, parent, and attempt identity.

Completed and uncertain portions are both kept. A lost response after an external operation does not prove that the operation failed. Restart, account repair, reconnect, acknowledging a card, or merely opening a result never causes a blind replay. Continuing where the agent supports it and starting a new attempt are different choices. Cancellation is not rollback. What survives a restart is listed in [recovery](../../operations/recovery.md).

Browser and computer takeover also transfers input ownership: automation and sensitive observation are suspended before the person types, and control returns only on an explicit hand-back. An expired lease cannot permit two controllers.

## Attention is a projection, not another execution engine

Attention items have a stable identity made of the actor, the source, and the generation of the issue. Chat, delegation, routines, proposals, browser and computer use, and workflows all produce them the same way; the sidebar, Catch up and the task board read the same authorized view.

| Operation             | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| Read/acknowledge      | The user has seen the item; no implied approval or completion.          |
| Resolve               | The underlying answer, repair, or decision clears that issue.           |
| Approve configuration | An explicit authorized version-bound decision, not a board movement.    |
| Cancel work           | An explicit request to the execution owner, not deletion of a card.     |
| Show result           | An authorized durable link, with partial/uncertain state still visible. |

Source identity prevents duplicate cards after replay. A new failed routine occurrence does not vanish because an earlier occurrence was acknowledged. Revoked links fail safely without leaking content.

## How these rules are checked

State transitions, stale versions, duplicate requests, and access between two users are covered by focused tests. Process, browser and desktop isolation are covered by suites that run on real containers (`ZETTA_DOCKER_TEST=1`, `ZETTA_VM_TEST=1`). The end-to-end scripts are in [`scripts/e2e`](../../../scripts/e2e).

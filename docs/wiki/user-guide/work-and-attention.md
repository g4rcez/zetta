# Give work, find results, and resolve blockers

[Wiki home](../README.md) · [Glossary](../glossary.md)

> **Status: intended v1 journey.** Examples describe required behavior, not implemented controls or verified runtime support.

## Give a clear task

Tell your chief the outcome, sources, and constraints, or talk directly to a specialist. For example: “Compare these approved sources, summarize disagreements, and link the evidence.” The chief can coordinate specialists without changing whose accounts the work uses.

Private chat supports Markdown, attachments, authorized server-file references, bot mentions, threads, and reactions. Mentioning a bot does not grant it access to another user's conversation or accounts. A reaction is not configuration approval or onboarding confirmation.

Work runs on the server. Closing or reconnecting the browser is not a cancellation or a request to repeat the task. Cancellation must be explicit; it cannot undo an external action that already happened.

## Read the outcome, not just the status

A useful task view answers:

- Which bot was responsible for each part?
- What completed, what remains, and what has an uncertain outcome?
- Where is the retained report or supporting output?
- Is there a safe next action that needs me?

For a task with two specialists, one successful result should remain available even if the other specialist loses account access. A partial result is not presented as complete, and completed work should not be repeated just to recover the failed part.

## Use the attention kanban

Sidebar, activity, and kanban use the same source-linked attention model. The kanban focuses on pending work needing your input, repair, or review, with resolved items available for follow-up. It is not a separate manual project tracker or an audit-log dump.

| What you see         | What it means                                 | What it does not mean                   |
| -------------------- | --------------------------------------------- | --------------------------------------- |
| Queued or working    | Execution is pending or active                | You must take action.                   |
| Needs input          | A task needs a specific answer or human step  | Any reply authorizes unrelated changes. |
| Blocked              | A prerequisite or operation prevents progress | Every previous step failed.             |
| Configuration review | A proposed change awaits a decision           | Reading the proposal approves it.       |
| New result           | There is output you have not acknowledged     | The whole task necessarily succeeded.   |

These are explanations of separate execution, attention, and read states—not one combined status enum. A blocker must not disappear merely because a result is also unread. Reading or moving a card cannot mark an execution successful, clear an unfixed blocker, or approve a proposal.

## Repair and return

1. Open the item and inspect completed, missing, and uncertain work.
2. Follow its authorized repair link, such as an account reconnection or setup question.
3. Complete the repair and return to the original task and retained output.
4. Inspect whether continuation is supported. Otherwise, review what a new attempt may repeat before deliberately starting it.

A successful reconnection does not automatically repeat the task. If a website action may already have happened, such as a submitted form with a lost response, its outcome needs reconciliation before another attempt. “Resume” must not be offered as a universal promise across execution tools.

An unavailable result or revoked resource should produce a clear explanation, not a leaked path or a fallback to another account. Folder placement does not grant access to cards or their result links.

Next: [correct and repeat useful work](learning-and-automation.md), or [take over a browser/computer session](browser-and-computer.md). External email, push, and mobile notifications are not required in v1.

## Implementation owners

[Chat recovery: RFC-027](../../../tasks/027-render-streaming-history-and-reconnect-states.md), [delegation outcomes: RFC-037](../../../tasks/037-aggregate-bounded-specialist-work.md), [routine outcomes: RFC-041](../../../tasks/041-show-routine-run-history-and-outcomes.md), [connection repair: RFC-044](../../../tasks/044-configure-bot-integration-bindings.md), [attention contract: RFC-071](../../../tasks/071-define-common-in-app-attention-state.md), and [kanban: RFC-072](../../../tasks/072-build-user-attention-kanban.md).

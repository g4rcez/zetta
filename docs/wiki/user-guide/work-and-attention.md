# Give work, find results, and resolve blockers

[Wiki home](../README.md) · [Glossary](../glossary.md)

## Give a clear task

Tell your chief the outcome, sources, and constraints, or talk directly to a specialist. For example: “Compare these approved sources, summarize disagreements, and link the evidence.” The chief can coordinate specialists without changing whose accounts the work uses.

Private chat supports Markdown, attachments, authorized server-file references, bot mentions, threads, and reactions. Mentioning a bot does not grant it access to another user's conversation or accounts. A reaction is not configuration approval or onboarding confirmation.

Work runs on the server. Closing or reconnecting the browser is not a cancellation or a request to repeat the task. Cancellation is explicit; it cannot undo an external action that already happened.

## Add to a task, correct it, or stop it

You can keep writing while a bot works, as you would to a person. Each message is saved at once and reaches the bot while it works: it reads the message at its next step, after the command it is running ends, and one answer covers everything you sent. A later message can therefore correct or cancel an earlier one: "send it to Ana", then "no, to Bruno" sends it to Bruno. If you ask something unrelated, a Claude Code bot answers it at once and carries on. If you write again before the bot has done anything, it starts over with all your messages together. A message shows a read mark once the bot has taken it.

Two things work differently. A bot on an engine other than Claude Code reads your message when its current run ends, not at its next step. A message with a picture, a file, picked skills or another bot named in it is answered right after the current reply; it says so under the message.

To stop the work, press Stop or type it: "stop", "cancel that", "para", "pode parar". The word alone is the Stop button; a sentence that only contains it ("stop the dev server and restart it") is an ordinary message. Stop ends the reply in progress, pauses the tasks the bot was being called back for, ends its goal loops, and silences rooms that chat opened that were still working. Messages the bot had not read yet stay in the chat and are not answered behind your back. When you write again, the bot sees them as earlier messages.

## Read the outcome, not just the status

The task view answers:

- Which bot was responsible for each part?
- What completed, what remains, and what has an uncertain outcome?
- Where is the retained report or supporting output?
- Is there a safe next action that needs me?

For a task with two specialists, one successful result stays available even if the other specialist loses account access. A partial result is not presented as complete, and completed work is not repeated just to recover the failed part.

## Use Catch up and the task board

The sidebar, Catch up and the task board use the same source-linked attention model. They focus on pending work needing your input, repair, or review, with resolved items available for follow-up. It is not a separate manual project tracker or an audit-log dump.

| What you see         | What it means                                 | What it does not mean                   |
| -------------------- | --------------------------------------------- | --------------------------------------- |
| Working              | Execution is active                           | You must take action.                   |
| Needs input          | A task needs a specific answer or human step  | Any reply authorizes unrelated changes. |
| Blocked              | A prerequisite or operation prevents progress | Every previous step failed.             |
| Configuration review | A proposed change awaits a decision           | Reading the proposal approves it.       |
| New result           | There is output you have not acknowledged     | The whole task necessarily succeeded.   |

These are explanations of separate execution, attention, and read states—not one combined status enum. A blocker does not disappear merely because a result is also unread. Reading or moving a card cannot mark an execution successful, clear an unfixed blocker, or approve a proposal.

## Repair and return

1. Open the item and inspect completed, missing, and uncertain work.
2. Follow its authorized repair link, such as an account reconnection or setup question.
3. Complete the repair and return to the original task and retained output.
4. Inspect whether continuation is supported. Otherwise, review what a new attempt may repeat before deliberately starting it.

A successful reconnection does not automatically repeat the task. If a website action may already have happened, such as a submitted form with a lost response, its outcome needs reconciliation before another attempt. “Resume” is offered only where the execution tool supports it.

An unavailable result or revoked resource produces a clear explanation, not a leaked path or a fallback to another account. Folder placement does not grant access to cards or their result links.

Next: [correct and repeat useful work](learning-and-automation.md), or [take over a browser/computer session](browser-and-computer.md).

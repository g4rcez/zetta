# Task follow-up: bots finish what they start

## Problem

A bot that works on its own sometimes stops in the middle. Two causes in the code:

- At the step limit (`CHECKPOINT_ROUNDS`, 12 tool rounds) a normal chat turn was told to stop and suggest a goal loop. If the user did not approve a loop, the work ended there.
- A reply that ends with "next I will..." is a finished turn. Nothing calls the bot again. Only a server restart resumed a turn.

Goal loops (`chat/loops.ts`) already push a bot to finish, but they need a card the user approves and are a separate, heavy path. The task board was inert: a bot moving its own task never woke it, and a task had no steps and no place to say where the bot stopped.

## Decision

A bot that takes on work of several steps writes **one task with subtasks** (`zetta:task add` with `subtasks`). The server then calls it back, one turn at a time, **while the task is open**.

- **Plan.** A task has steps (one level, at most 30), a `progress` note (what is done, where the bot stopped, what comes next) and a follow-up state: `auto` (the server calls the bot back), `paused` (the server stopped, with `follow_up_reason`), `off`. A task a bot adds for itself is `auto`; a task made on the board, or a task for a person, is `off`.
- **Heartbeat** (`chat/task-heartbeat.ts`, ticked every 30 s with the other workers). A followed task is due when `next_check_at` has passed. The check is a quiet turn in the task's chat (a `notice`: a short "↻ Continuing: ..." line in the chat, a hidden prompt for the bot with the user's request, the steps and the progress note). In a room it wakes only the member that owns the task.
- **Quiet chat.** When any turn of the bot in that chat ends, its followed tasks wait 2 minutes (`QUIET_MS`), so a check never lands beside the user typing. A busy chat, a queued message or an active goal loop of the same bot postpones the check without counting it.
- **Stop means stop.** The user pressing Stop pauses the bot's followed tasks in that chat ("stopped by you", no card). "Pause everything" does not: the tasks wait and go on after resume.
- **Done is checked.** A bot closes a followed task with `status: done` only when every step is done (the store refuses otherwise and names the open steps), and then the same independent check as a loop's `goal_done` (`checkDone`) reads the user's request and the bot's progress. If something is missing the task stays `in_progress` and the reason goes back to the bot.
- **Limits.** 3 follow-ups in a row that change nothing (no step moved, no progress note change) pause the task and raise an attention card ("A bot stopped before finishing a task"). A failed turn waits and retries with the loop backoff (`chat/retry.ts`); a sign-in problem pauses. 40 follow-ups pause the task too. A bot that chose a later time on purpose (`checkAt`, at most 7 days) is not stalled. Resume (the task page or `PATCH followUp: "auto"`) starts the counters over and closes the card.
- **Checkpoint.** At the step limit a bot with a followed task is told to save its place (steps, progress) because it will be called back; a bot without one is told to add a task for what is left. `zetta:task` still runs after the checkpoint.

## Trust

The result of a bot's own `task add` or `update` is a line the server wrote (ids, or why a rule refused), so a round with only those calls does not mark the turn as having read outside content. Without this, every step update after the first would turn into an Approve card. `task list` and `task get` still do: they return text other bots and people wrote. After outside content a bot's own task writes still apply at once: a task add, a step added under its own task, and an update of a task whose `bot_id` is the bot's (its tasks, its steps, and what `zetta:assign` gave it). One card per step move was noise, and the held moves stalled the follow-up. Only a task for another person (`assignee` other than `user`) and an update of a task the bot does not own (made on the board, or by another bot) wait for the user's card. The progress note and the titles come back to the bot as data (fences defused), like a loop's lessons.

## Not done

- Tasks that `zetta:assign` puts on a member in a room are not followed; the member's own tasks (added by the member) are.
- No separate view of every followed task or of the check history; the task page shows the state, the next check and the note.
- No live event for a check: the open task page polls every 10 s while the task is followed.
- A task asked of a person (`assignee`) is never followed; the existing wake on the person's move still applies.

## Where

`packages/db/src/schema/tasks.ts` (columns), `modules/tasks/{store,follow-up,routes}.ts` (rules, limits, API), `modules/chat/task-heartbeat.ts` (driver), `modules/chat/service.ts` (`runTask`, `settleFollowUps`, checkpoint), `services.ts` (wiring), `apps/web/src/features/tasks/task-plan.tsx` (steps and follow-up on the task page).

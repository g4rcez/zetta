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

The result of a bot's own `task add` or `update` is a line the server wrote (ids, or why a rule refused), so a round with only those calls does not mark the turn as having read outside content. Without this, every step update after the first would turn into an Approve card. `task list` and `task get` still do: they return text other bots and people wrote. After outside content a bot's task writes still apply at once, for every bot: `task add` (also for another person and under any parent) and `task update` (also of a task made on the board or by another bot), and a member's `zetta:assign`. Changed on 2026-11-14 by the owner's decision: a card per task blocked the work, and the board is the user's own. The store still limits it: every write runs as the owner, and a task for another person must be a live person of an active team of the owner. Still held: `task remove` is the Chief's and always a card, and an inbound chat (answering outside people) drops task and assign calls. A card raised before this change still runs its task calls when approved. The progress note and the titles come back to the bot as data (fences defused), like a loop's lessons.

## Not done

- Tasks that `zetta:assign` puts on a member in a room are not followed; the member's own tasks (added by the member) are.
- No separate view of every followed task or of the check history; the task page shows the state, the next check and the note.
- A task asked of a person (`assignee`) is never followed; the existing wake on the person's move still applies.

## Showing the work

A bot's task must be visible while the bot is on it, and the person must be able to follow every bot's work until it is Done.

- **Where the bot is.** A bot's status (`chat/bot-status.ts`) now names its current task: the open, top-level task the bot owns for itself that is furthest along (`in_progress`, then a followed backlog task, then a plain backlog task, then one held for a person; the most recently touched among equals), with its steps done and total. The reason reads `Working on “Title” · 2 of 5 steps done` while a turn runs, `Continues “Title” soon` for a followed task, and `Online, 3 open tasks` otherwise. The status enum did not change. It is derived from the database, not from the live turn, so a follow-up turn and a normal turn read the same. Tasks asked of a person (`assignee = person`) and other people's tasks never count.
- **Backlog is not work.** A step that moves to `in_progress` or `done` takes its task out of the backlog (store `update`); a followed task still in the backlog moves to `in_progress` when its check starts (`store.start`, in the heartbeat). A task held in `blocked` or `review` stays there. The move is not counted as progress by the stall check.
- **Live.** The `tasks` live topic (`packages/core/src/live-topics.ts`) is published after every task write (`store.onChange`, wired in `services.ts`) together with `bot-status`. The web maps it to `["tasks"]`, so the board, a task page and the bots' "working on" line refresh without a reload. The heartbeat's own bookkeeping (`finishCheck`, `postpone`, `quiet`) does not publish, so a check every 30 s does not refetch pages.
- **Web.** `BotCurrentTask` (chat header, details panel, links to the task); the task card shows the bot's live status when the bot is on that task, and the first line of its progress note. The tasks page has a `stage` filter (`any`, `open`, `done`; `open` means not Done) and the bot choice `bots` (any bot), both in the URL. The "Work in progress" button sets `stage=open&botIds=bots&groupBy=assignee`, one lane per bot, and a task leaves it when it reaches Done.

## Where

`packages/db/src/schema/tasks.ts` (columns), `modules/tasks/{store,follow-up,routes}.ts` (rules, limits, API), `modules/chat/task-heartbeat.ts` (driver), `modules/chat/service.ts` (`runTask`, `settleFollowUps`, checkpoint), `services.ts` (wiring), `apps/web/src/features/tasks/task-plan.tsx` (steps and follow-up on the task page), `task-filters.ts` and `tasks-page.tsx` (the Work in progress view), `components/bot-status.tsx` (`BotCurrentTask`).

# Projects and "needs you" work cards

A manager's view of a team of bots and people. Decided on 2026-11-14 in an interview with the owner; built in phases from 2026-11-15.

## Why

A product manager runs a mixed team of bots and humans in Zetta. The only way to know how work was going was to read chats or ask someone. Two things were missing:

- **Micro:** hearing about work that is stuck, blocked or going a different way than asked, and answering it without opening the chat.
- **Macro:** seeing where each larger piece of work stands.

Success: a manager who cannot read code or logs opens the Inbox and knows in 10 seconds what needs them, acts from the card, and the Projects page answers "where does each project stand" without asking anyone.

## What was decided

- Work that needs the manager arrives as cards in the existing Inbox (`/catch-up`). One queue holds bots and people.
- Each card shows the situation and **suggested next steps** as buttons. They are suggestions: the manager can always write their own answer.
- A **Project** groups tasks, rooms, bots and people under one brief, and has its own memory for its bots.
- Drift ("going a different way than asked") is checked only on project tasks.
- A manager's message reaches a person as a card in that person's Inbox.
- A project is visible to its owner and, read-only, to the people on it.

Out of scope: deadlines and "late" triggers, digests, coaching from patterns over time, a roll-call board, project bots reading full room histories, people reading project memory, deleting a project (archive only).

## The non-technical manager test

The first plan was right about the data and wrong for a manager in eleven places. Each one is a rule of the design:

1. A manager must be able to hand out work. The task API had no assignee, so only bots could create work for bots or people. The project page has **Ask for something**.
2. Feedback works on any task, not only on what Zetta flagged (**Tell them…**, phase 4).
3. A blank "brief" box stops people. A project is a name and one sentence; the chief bot drafts four short answers the manager corrects.
4. No internal word reaches the screen: follow-up, stall, paused, drift, heartbeat, fingerprint. A test bans them on project screens.
5. Counts are not an answer. Every project shows one word and one sentence: "Needs you: 2 tasks are waiting on you. 7 of 12 done."
6. Work outside every project stays visible: "Not in a project: 14 tasks still open".
7. People are not watched like bots. A person is asked first ("Still working on this?"), idle time counts working days only, and the manager hears about it only when the person says they are blocked or does not answer. Colleagues never see each other's flags.
8. "Blocked" comes with a reason ("What is in the way?").
9. A button says what it will do: it shows the message it sends, destructive ones can be undone, and the card confirms what happened.
10. Two management moves exist as buttons: "Give it more time" and "It's fine as it is". The card shows what the manager already decided on that task.
11. Each project has a dial: **How closely to watch: Closely / Normally / Lightly**.

## Wording

| In the code           | On screen                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `work_stuck` (bot)    | "Dev bot stopped on step 3 of 5 of _Launch email_. It tried 3 times and nothing changed." |
| `work_stuck` (person) | "Ana has not answered about _Pricing table_ since Tuesday."                               |
| `work_blocked`        | "Ana is blocked on _Pricing table_: waiting for the legal text."                          |
| `work_drift`          | "_Launch email_ is going a different way than asked." then **Asked / Doing**              |
| `followUp = paused`   | "Stopped"                                                                                 |
| `resume_follow`       | "Ask it to continue"                                                                      |
| `message_worker`      | "Tell it what to do" / "Tell Ana"                                                         |
| `reassign_*`          | "Give it to someone else"                                                                 |
| snooze                | "Give it more time"                                                                       |
| accept direction      | "It's fine as it is"                                                                      |
| project `paused`      | "On hold"                                                                                 |

Task status names stay as the Tasks board shows them, so the two pages agree. Text a model writes follows the language of the task's conversation.

## Data

- `project`: owner, name (unique per owner while not archived), labels, `status` (`active | paused | done | archived`), `watch` (`close | normal | light`) and the brief as four fields: `outcome`, `audience`, `done_when`, `not_included` (1000 characters each).
- `project_member`: a bot, or a person with the team of the owner through which they were added. A person counts only while they are a live person of that team, the same rule as task visibility.
- `task.project_id` and `discussion.project_id`, both nullable and `set null`. A step always has its task's project.
- `memory_item_project` and the memory type `project`: an item read only by the bots on its projects, and by the owner.
- `attention_item.work`: a work card's suggested next steps and the one the person chose. Default steps are not stored; they are built when the card is read.
- `work_watch`: one row per task and kind (`stuck`, `blocked`, `drift`, `checkin`). It holds "give it more time", "it's fine as it is", when a person was asked, and later the drift throttle.
- No `workspace_id` yet: workspaces are still a spec (`workspaces.md`). When they land, `project` is tenant-direct and its children tenant-child.

**Which project a new task joins.** The project named by the owner. Else the project of the room the task was made in. Else the one active project its bot is on. A bot on two projects gives no answer and the task stays outside until the owner files it. A paused, done or archived project takes no work by itself.

**Health** is computed, never stored (`packages/core/src/projects.ts`): `needs_you`, `quiet`, `on_track`, `done`, `on_hold`. "Needs you" counts tasks that are blocked, in review, or have an open Inbox card of the owner. "Quiet" is open work with no change for 3 working days. A person who is not the owner never gets "needs you".

## What a bot on a project gets

- **The brief.** Every turn of a bot carries the briefs of the active projects it is on (at most 3, newest first), framed as data between markers, in the turn text and never in the system text. A turn with outside people in play gets none.
- **A room's project.** A member of a room that is not on the room's project still reads that project's brief in the room prompt.
- **Project memory.** A memory item of type `project` is read by the bots on that project and by the owner, by no other bot. A bot files an item only under a project it is on. In a room of a project the bot is on, a new item with no type goes to the project; in its own chat the bot must ask for `"type":"project"`, so what it learns about the owner in general still reaches every bot. Under each brief the bot sees the 4 newest items of that project's memory.
- A paused, done or archived project gives no context and takes no new items by default. Its memory stays readable to its bots.

## Work cards

Five kinds of card (`packages/core/src/work-suggestions.ts`). Three go to the manager, who is the owner of the task; two go to the person a task is assigned to.

| Card           | Who gets it | When                                                                                                                                                                                                                                                                                    |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `work_stuck`   | manager     | The server stopped calling a bot back for a task (it replaces the old `task_follow` card). A bot task in progress that nobody follows had no change for 2 hours. A person was asked and did not touch the task for 1 working day. A person did not answer a check-in for 1 working day. |
| `work_blocked` | manager     | Whoever does the task moved it to Blocked. The card carries what they said is in the way. The owner blocking their own task tells nobody.                                                                                                                                               |
| `work_drift`   | manager     | Phase 6.                                                                                                                                                                                                                                                                                |
| `work_checkin` | the person  | Their task in progress had no change for 2 working days: "Still working on this?".                                                                                                                                                                                                      |
| `work_nudge`   | the person  | The manager wrote to them about a task.                                                                                                                                                                                                                                                 |

Rules:

- **People are asked first.** A quiet task of a person raises a check-in for them, not a card for the manager. "Yes, on it" tells nobody and leaves them alone for 2 more working days. The manager hears only when they say they are blocked or a working day passes with no answer.
- **Colleagues see nothing.** A card goes to one person. A person on a project never receives a card about somebody else's task.
- **A card ends by itself** when it is answered by events: a stopped or quiet task changes, a blocked task leaves Blocked, a task is done or deleted (`catch-up/queue.ts` `judge`).
- **The scan never nags** (`modules/work/scan.ts`, every 5 minutes): it raises no second card while one is open, and stays silent while a task is quiet (`work_watch.quiet_until`) and unchanged. A manager who paused their agents is not told that their bots are quiet.
- **How closely to watch** scales every wait: Closely ×0.5, Lightly ×2. Lightly also checks on nobody: no check-ins and no "has not answered".

### Next steps on a card

A work card shows up to 4 next steps. Each is a button with its name and, under it, one sentence that says what pressing it does. Keys 1 to 4 press a step, A presses the first, D is "Not now" with a 5 second undo.

| Step                                         | For                | What it does                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tell it what to do / Tell Ana                | manager            | The message goes to the bot where it works on the task (its room, the task's chat, or the manager's chat with it); a stopped bot starts again. For a person it becomes a card in their Inbox.                 |
| Ask it to continue                           | manager, bot tasks | The bot is called back for the task again.                                                                                                                                                                    |
| Give it to someone else                      | manager            | The manager picks who: another member of the task's project, or outside a project one of their bots or team people. A bot is told in its chat and followed until done; a person gets the task in their Inbox. |
| Give it more time                            | manager            | The card goes away for a working day, unless the task changes. "Not now" does the same.                                                                                                                       |
| It's fine as it is                           | manager, drift     | Nobody asks about the direction of the task for 30 days, unless it changes.                                                                                                                                   |
| It is done / Drop the task                   | manager            | Close or delete. Deleting waits 5 seconds with an Undo. Offered only when Zetta suggests them (phase 5).                                                                                                      |
| Yes, on it / I'm blocked / It's done / Reply | the person         | "I'm blocked" asks what is in the way and moves the task to Blocked. A reply reaches the manager as an update (`work_reply`), not as another decision.                                                        |

- A step that sends words shows them first. The manager changes them freely, and an empty message is never sent.
- Every step answers with one sentence that says what happened ("Sent to Scribe. It reads it now and goes on from there."), shown as a toast.
- What was chosen is kept on the card (`work.chosen`). The next card about the same task lists the last 3 choices under "What you chose before".
- The steps are a closed list checked on the server (`ALLOWED_WORK_ACTIONS`): a suggestion can never run anything else, and a target is checked against who the task may go to.

### Outside the Inbox

- **Tell them…** on every task row of a project page (`POST /api/tasks/:id/tell`): the owner writes to whoever does any of their tasks, flagged or not.
- **What is in the way?** on the task page: a person who moves someone else's task to Blocked is asked for the reason first.

## Phases

| Phase | What                                                                  | State            |
| ----- | --------------------------------------------------------------------- | ---------------- |
| 0     | This document                                                         | done             |
| 1     | Project tables, store, rollup, API, hand out work, draft the brief    | built 2026-11-15 |
| 2     | Projects list, new project, project page, project filter on the board | built 2026-11-15 |
| 3     | Project brief and project memory in a bot's context                   | built 2026-11-15 |
| 4     | Work cards by rule, cards with several buttons, check-ins for people  | built 2026-11-15 |
| 5     | Suggested next steps written by the chief bot                         | open             |
| 6     | "Going a different way" check on project tasks                        | open             |
| 7     | Chief sets up a project from a conversation                           | open             |

## Where the code is

- Schema: `packages/db/src/schema/projects.ts`, `memory.ts`, `work.ts`; migrations `20261115043309_project`, `20261115165413_memory_item_project`, `20261115170432_work_cards`.
- Shared: `packages/core/src/projects.ts` (health), `packages/core/src/working-days.ts`.
- Server: `apps/server/src/modules/work/` (`cards` wording, `actions` what each step does, `scan`, `watch`, `facts`, `thresholds`); the Inbox reads and runs them through `catch-up/queue.ts` and `catch-up/act.ts`.
- Server: `apps/server/src/modules/projects/` (`store`, `routes`, `auto-join`, `work`, `draft`, `context`), `apps/server/src/modules/chat/one-shot.ts` (one question to the chief engine, answered as JSON).
- Web: `apps/web/src/features/projects/`, routes `/projects`, `/projects/new`, `/projects/$projectId`; the work card is `apps/web/src/features/catch-up/work-card.tsx`.

## Differences from the approved plan

- There is no `/archive` route: archiving is `PATCH` with `status: "archived"`.
- Health has a fifth state, `on_hold`, for a paused project.
- Asking a bot for something creates the task first and tells the bot in the manager's own chat with it, not in a project room. The task exists and is followed even if the bot plans nothing, and the page shows it at once. A room's conversation refuses direct turns.
- A task in **Review** counts as waiting on the manager.
- "Needs you" on the project page links to the Inbox card or the task. The card itself is answered in the Inbox, not inside the project page.
- A stopped task keeps the card key `task-follow:<id>`, because the task store already closes that key when a task is followed again or done. The other cards use `work-<kind>:<id>`.
- The actions are named `tell`, `resume`, `reassign`, `more_time`, `accept` and so on, not the names in the plan. One `tell` covers a bot and a person, and one `reassign` covers both targets.
- "It is done" and "Drop the task" are accepted but not among the default steps: four buttons are the limit, and they are the least likely next step. Phase 5 can suggest them.
- A person's "not now" on a check-in counts as no answer: the manager still hears after a working day.
- The new-project form has no "Open a room for it"; rooms are attached on the project page.
- The project memory under a brief is the 4 newest items of that project, not a search against the request: the normal memory search of every turn already ranks project items with the rest.
- Idle time is counted in UTC working days. No per-person time zone exists yet (routines and agenda items carry their own).

## Not verified

- Looked at in a real browser and with a real model on 2026-11-15 (`scripts/e2e/project-pages.ts`, `docs/verification/e2e/project-pages.md`): a project with a bot on it, asking for work, the page naming the worker and the task; the one-sentence brief draft with Claude haiku returned four sensible answers and a sentence with a key was not sent. Before that the pages were checked with DOM tests and the API with integration tests on the embedded Postgres.
- The "What is in the way?" box on the task page has no DOM test; the server side of it is tested.
- The work scan was tested by calling it with a set clock, not by letting the server's ticker run it.

# Organization chart: people and bots in one company tree

Decided on 2026-11-15 in a planning session with the owner; built the same day.

## Why

Teams (`/teams`) group bots for rooms, one team per owner, flat, with one bot chief. Nothing said who leads the company, which person or bot answers to whom, or who should hear when work stops. The owner asked for a canvas that shows the humans and the bots with their roles, lets the admin set the major seats (the CEO and the team leaders), and starts from templates of roles most organizations have.

## What was decided

- **One shared chart per installation** (one per workspace once workspaces land). Every member reads it; only the admin changes it.
- **A seat is held by nobody, a person or a bot.** The CEO and the leaders can be people or bots. A team keeps its bot chief as the coordinator of its rooms; a seat can link a team the admin owns (`team_id`), and the chart then says who leads it.
- **Only team-visible specialist bots can hold a seat.** A private bot and every personal Chief are refused. A holder that stopped being valid (a member who left, a bot that went private or was archived) reads as an open seat with a note ("Open seat (was Rui)"); the bot's owner sees that it was their bot.
- **The chart changes behaviour**, within one rule: **the chart decides who should hear; access decides whether they can.**
- **A new `/organization` page**, next to Teams, which stays the team editor.

## Behaviour

| Where                         | What the chart does                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bot's turn                  | A bot that holds a seat reads its seat, what it decides alone and what goes up, whom it reports to (a bot as a mention, a person by name), its reports and the CEO. The text is data, framed with markers. The user's Chief reads the top two levels and the seats of the user. Not with outside people in play (`noCode`).                                                                                                 |
| A team room                   | A line says who the chart says leads the team.                                                                                                                                                                                                                                                                                                                                                                              |
| `zetta:escalate`              | A stuck bot asks its nearest manager that is actually there. A manager that is a team bot takes the Chief's place in the help room, and its answer resumes the bot. A manager that is another person is named in the request; nothing of the chat goes to them. No seat, no manager, or the user themselves: the Chief, as before.                                                                                          |
| Stopped or blocked work cards | The card with the buttons stays with the task's owner. The nearest person the chart puts above whoever does the work gets a **read-only heads-up** (`work_heads_up`, no buttons), and the owner's card says so. The heads-up names the task only when that person could already read it (a live person of the owner's team on the task's project); otherwise it says only that someone under them stopped, and who decides. |
| The Chief                     | `zetta:org` reads the chart for anyone and proposes changes for an administrator. Every change is an Approve card.                                                                                                                                                                                                                                                                                                          |

## Who can change the chart through a bot

Decided on 2026-11-15. The administrator manages the chart in three ways besides the web page; none of them gives a bot a power the administrator does not have.

- **The Chief** (`zetta:org`): list, add a seat (with a unit and a description), edit a seat (title, level, unit, description, and the team it runs), put a person or a team bot in a seat, move or reorder (`index`), remove, apply a template.
- **Any bot the administrator owns**: the same tool, and the prompt says so (`ORG_BOT_TOOLS`). A bot the administrator only shares with the team, another member's bot, and any turn with outside people in play are refused. The check is `adminBotMay`: the actor is the administrator **and** owns the bot.
- **External AI over MCP** (`/api/mcp`): `get_org_chart` for any member; `add_org_seat`, `update_org_seat`, `move_org_seat`, `set_org_seat_holder`, `remove_org_seat` and `apply_org_template` only when the token's member is the administrator and has the write scope. Every call is audited and takes `expectedVersion`.
- **Every change a bot proposes is a card, every time.** The card is approved by the person whose turn made it, and the store checks `isAdmin` again when it is applied. An org card is never remembered by "Always allow" (`NEVER_REMEMBERED_TOOLS`), because one rule would cover removing seats as well as adding them. Adding or removing a person of a team (`team:people`) is also never remembered.

## Deviations from the first plan

- **Approvals stay with the owner.** Approving a tool runs with the owner's accounts, and `docs/decisions/ownership.md` says only the authorized human approves. The chart never moves an approval.
- **Work cards are not handed to a manager who is not the owner.** Every button on a work card acts on the task (it writes in the owner's bot chats, moves and drops the task), and those actions check that the actor owns it (`work/actions.ts`). Giving another person those buttons would mean running the owner's bots as someone else, which `ownership.md` forbids. So the manager hears (a heads-up with no buttons) and the owner acts. Delegated rights over a task (a manager who can reassign or close a report's work) are a decision of their own and are not built.
- **A role template has two fields for what a seat decides**: `decides` (alone) and `goesUp` (to its manager), not one.
- **The preamble cap was raised**, from 32,950 to 33,450 characters, for the `zetta:org` line (about 450). The Chief had 5 characters of room.

## Data

`org_chart` (one row; `version` is the compare-and-swap token of every edit) and `org_position` (`parent_id` is "reports to"; `rank` ceo|executive|lead|member; `seat` open|person|bot; a check ties the root to the CEO rank, another ties the holder columns to the seat kind; a unique index allows one root). No triggers. The app checks cycles and depth (at most 12 levels, 300 seats). Ranks, seats and the tree rules are pure code in `packages/core/src/org.ts`, shared by the server and the web app, so a drop is refused before it is sent and refused again on the server.

Role templates (24 seats in five groups) and structure presets (solo founder, small startup, agency, software product team, customer support desk) live in `packages/core/src/org-templates.ts`. A company preset needs an empty chart; a team preset hangs under a seat, or under an open CEO on an empty chart.

## Where things are

- Server: `apps/server/src/modules/org/` (`store.ts` writes and `readOrg`, `routes.ts` at `/api/org`, `context.ts` prompt text, `escalation.ts`, `work-note.ts`) and `chat/chief/org.ts`.
- Web: `apps/web/src/features/org/` (page, canvas, outline, seat page, palette, add-seat panel, start screen), routes `/organization` and `/organization/$positionId`.
- Live topic `org`: a write refreshes every open chart.

## The non-technical test

Plain words on screen ("Reports to", "Open seat", "Leads"), every button says what it does, a refusal says why ("A seat cannot report to one of its own reports"), and the outline view does everything the canvas does except dragging, so it works on a phone, with the keyboard and with a screen reader.

## Not done

- Delegated rights over a task for a manager who is not the owner.
- Workspaces: one chart per workspace. `workspaces.md` describes `workspace_id` on `org_chart`, but the workspace tables (its phase P1) do not exist yet, so there is nothing to point at. Add the column when P1 lands.

## Verified

Server integration tests on a real database, the web app in a real headless browser (drag, menus, seat page, phone, member view, empty start screen), and a real model: given the turn text of a seated bot and of the Chief, it names the manager and the CEO correctly. A real model's judgment about when to escalate (rather than reading the chart back) has not been tried.

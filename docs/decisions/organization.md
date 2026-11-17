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
- Web: `apps/web/src/features/org/` (page, canvas, outline, seat panel, holder picker, add-under form, start screen), route `/organization` (the old `/organization/$positionId` redirects to `/organization?focus=<id>`).
- Live topic `org`: a write refreshes every open chart.

## Added 2026-11-16: draw it from the teams, and the works-with layer

- **Draw it from my teams** (start screen). `GET /api/org/draft` returns a proposal, `modules/org/draft.ts`: a CEO seat (open), one leader seat per active team the admin owns (the team's chief holds it when that bot may hold a seat; the seat is linked to the team), and a seat under it for each other team bot (titled by the team role, else the bot's role, else its name). A bot that cannot hold a seat (private, archived, a personal chief of staff) or that already has one under another team is listed under `skipped` with the reason. Nothing is saved by the read. `POST /api/org/draft` confirms: the server rebuilds the same draft inside the chart's transaction, minus the teams (`skipTeamIds`) and bots (`skipBotIds`) the admin unticked, and writes it in one step into an empty chart. One new write instead of many calls of the seat endpoints, so a half-drawn chart cannot happen.
- **Works with** (`show=links`). `GET /api/org/links` returns `{ aId, bId, weight, kinds, counts }` pairs of bot ids, only for bots that hold a seat. Sources, all read from existing rows and scoped to the reader: members of the same room (open, paused or stalled, or changed in the last 90 days; rooms of more than 12 bots are skipped), bots that follow each other in a workflow graph (through steps that belong to no bot), and `decision_config` options that delegate to another bot. At most 150 pairs, strongest first. No table; the web app draws them as dotted lines, and as a list in the outline view.
- **Chief and MCP.** `zetta:org` has the read action `works_with`; the MCP server has `get_org_works_with`. The draft has no Chief action: confirming it is a write and would need its own approval card.

## Changed 2026-11-17: one panel, share on pick

The admin found the page hard to use: bots could not be put in seats, and editing was spread over a drag palette, a card menu, a panel above the chart and a separate seat page. Decided in an interview the same day.

- **One docked panel edits a seat.** Clicking a seat (canvas or outline) selects it in the address (`focus`) and opens the panel beside the chart (under it on a phone). It holds who holds the seat, who it reports to (with earlier/later among siblings), who reports to it, the words of the seat, add under, and remove. The palette, the card menu, the add-seat panel and the seat page are gone; `/organization/$positionId` redirects to `/organization?focus=<id>`.
- **No dragging of seats.** A scroll pans the canvas, a pinch or Ctrl+scroll zooms, a drag pans. A seat moves through "Reports to". A search lists the matches in outline order; Enter goes to the first, then the next, and the canvas moves only when the seat is out of sight.
- **Private bots are listed; seating one shares it.** The palette now holds the bots shared with the team and the admin's own private specialist bots (`visibility` on each). Another member's private bot is never offered. Picking a private bot asks "Share _X_ with the team?"; on yes the web sends `shareBot: "team"` and the server, in the seat's transaction, checks that the actor owns the bot, sets it to team, bumps `version` and writes a `bot_revision` (`snapshotBotConfig`, now in `modules/bots/bot-revision.ts`, shared with the chat service). Without `shareBot` a private bot is still refused. `shareBot` is a string enum on purpose.
- **Add under asks who first.** `POST /api/org/positions` takes an optional `holder` and `shareBot` and writes the seat and its holder in one transaction (`applyHolder`, shared with `seat`), so a refused holder leaves no seat behind.
- **Kept as before:** the bot tools, the Chief (`zetta:org`) and MCP do not take `shareBot` or a holder on create: a bot-driven change still asks the owner to share first, and the preamble cap is unchanged.

## The non-technical test

Plain words on screen ("Reports to", "Open seat", "Leads"), every button says what it does, a refusal says why ("A seat cannot report to one of its own reports"), and the outline view does everything the canvas does, because both select a seat and change it in the same panel, so it works on a phone, with the keyboard and with a screen reader.

## Not done

- Delegated rights over a task for a manager who is not the owner.
- Workspaces: one chart per workspace. `workspaces.md` describes `workspace_id` on `org_chart`, but the workspace tables (its phase P1) do not exist yet, so there is nothing to point at. Add the column when P1 lands.

## Verified

Server integration tests on a real database, the web app in a real headless browser (panel, share-on-pick, add under, wheel pan and zoom, search, phone, member view, empty start screen), and a real model: given the turn text of a seated bot and of the Chief, it names the manager and the CEO correctly. A real model's judgment about when to escalate (rather than reading the chart back) has not been tried.

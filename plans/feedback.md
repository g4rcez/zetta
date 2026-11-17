# Client feedback plan (2026-11-16)

## Context

A client running a self-hosted installation sent feedback after a first trial. They like the idea (tasks, wiki, agents and chat in one workspace), the self-host setup, invites and routines. They reported bugs with self-hosted models, an interface that scares less technical people, and a list of missing features.

I checked each point against the code. The result changes the plan:

- **Three "missing" features already exist.** The client found them but could not tell how to use them: the organization chart, quoting a message, and Google Calendar. These are clarity problems, not builds.
- **Self-hosted models have no supported path at all.** A local model only works if someone configures a third-party CLI by hand on the server. The "bugs" come from that.
- **Six things are truly missing:** message editing, profile fields, bot role in pickers, an update notice, Figma, and a spoken voice mode. The mobile app is half there (installable web app, no push).

Decisions already taken with the owner:

| Feedback point                         | Decision                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Suggestion tracking by e-mail          | Skipped. Not in this plan.                                                    |
| GPT without spending work-plan credits | Skipped. The answer is the local Codex CLI / Codex app sign-in on the server. |
| Org chart, quote, Calendar             | Exist. Plan makes their use clear.                                            |

## Where each point stands

| #   | Feedback                      | Today                                                                                                         | Work       | Size* |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------- | ----- |
| A   | Bugs with self-hosted models  | No engine takes a base URL; only Claude Code is verified                                                      | Phase 2    | L     |
| C   | Advanced settings too visible | One `Simple/Full` preference that only hides sidebar links                                                    | Phase 1    | M     |
| D   | Routines interface messy      | Two different forms, 8 actions per row                                                                        | Phase 1    | M     |
| E   | Bot role in pickers           | 8 native selects show the name only; bots have no role field                                                  | Phase 1    | M     |
| F   | Job title and other user info | Profile is name + avatar only                                                                                 | Phase 3    | M     |
| G   | Org chart / agent relations   | `/organization` exists; empty until an admin draws it; no "works with" view                                   | Phase 1    | M     |
| H   | Calendar                      | Google plugin + Agenda sync exist; Agenda hidden in Simple navigation; setup needs an own Google Cloud client | Phase 1, 6 | S + M |
| I   | Figma                         | Nothing                                                                                                       | Phase 6    | M     |
| J   | Edit messages                 | No column, endpoint or UI                                                                                     | Phase 3    | M     |
| K   | Quote messages                | Exists as "Reply"; invisible on touch screens; whole message only                                             | Phase 1, 3 | S + S |
| L   | Room description              | `goal` + `context` exist, plain text, only inside a drawer                                                    | Phase 1    | S     |
| M   | Update available              | No version anywhere, no git tags                                                                              | Phase 3    | M     |
| N   | Voice mode                    | Speech to text only; speech out only through the ElevenLabs tool                                              | Phase 4    | L     |
| O   | Mobile app                    | Installable PWA, QR pairing; no push, no touch actions, no safe areas                                         | Phase 5    | L     |

\* Size is my estimate: S about a day, M a few days, L a week or more.

## Phase 1 — Make what exists clear

Small changes, all aimed at the less technical user. No new concepts.

### E. Bot role everywhere a bot is chosen

- **Data:** add `bot.role` (short text, up to 60 chars, default `''`) in `packages/db/src/schema/chat.ts`. The migration fills it from the seat title when a bot holds exactly one seat in `org_position`. `bot.description` stays as the long text.
- **One rule for the label:** `botRole(bot)` in `packages/core`: `role`, else seat title, else first line of `description`, else `Chief` / `Specialist`.
- **Where it is set:** Identity step of `apps/web/src/features/bots/bot-onboarding.tsx` (templates prefill it), General form of `features/chat/bot-settings.tsx`, and the Chief's `zetta:bot` tool (bot parity).
- **One picker:** new `components/bot-select.tsx` on the library `Autocomplete` with a `Render` per option that draws `BotIdentity` with `sub={role}`. Move `features/skills/bot-picker.tsx` to `components/` for the multi-select case.
- **Replace the name-only selects:** `routines/routines.tsx:395,543`, `studio/workflows.tsx:384`, `studio/workflow-canvas.tsx:331,391`, `chat/bot-decision.tsx:223`, `memory/add-source-page.tsx:269`, `memory/item-fields.tsx`, `skills/my-skills.tsx:260`, `artifacts/artifacts-page.tsx:164`, `teams/new-team-form.tsx:94`.
- **Also show the role** in the `@` mention popup (`chat/mention.tsx`), the task assignee filter and the org seat holder.
- **Guard:** a web test in the style of `src/icon-buttons.test.ts` that fails on a `Select` fed with `bots.map(... label: b.name)`.

### C. Fold advanced settings

- **Shared piece:** `components/advanced-section.tsx` (native `<details>`, one style). Replace the ten hand-written `<details>` blocks (wizard `ExtraSection`, `whatsapp-install.tsx`, `tool-picker.tsx`, `google-connect.tsx`, `studio/accounts.tsx`, `studio/decisions.tsx`, `claude/claude-section.tsx`, `routines.tsx`).
- **Give `navMode` a meaning inside pages.** In `simple`, these start folded under "Advanced"; in `full` they stay as today:
  - Bot settings: engine, model, fallback engine and model, Chat memory, Agent settings, Hooks, Decision routing, Incoming message filters, Commit as, Computer use.
  - Bot wizard: other engines and the model select; the Accounts step.
  - Routines: see D.
- Rename the preference label from "Navigation" to "How much to show" (`features/preferences/display-section.tsx`). Values stay `simple | full`.
- **New people start Simple.** Today only the installing admin does. The migration first writes an explicit `full` row for every existing user who has none, then the default becomes `simple` (schema default and `preferences.tsx:69`). Existing accounts see no change.
- Nothing is removed and nothing gets a Beta label; folded sections open with one click.

### D. Routines

- One `RoutineForm` for create and edit. Create moves from the modal to a page (`/routines/new`); edit lives on the routine page only. Remove the inline edit in the list row.
- List row keeps: title, status, bot with role, schedule, next run, and `Run now`. Everything else goes in a "More actions" menu or the routine page.
- Form: timezone defaults to the browser's and shows as one line with "Change"; the cron examples, "Run a workflow instead" and the Behavior form go under the Advanced section.

### K (part 1). Quote is findable

- Rename the two neighbours in `features/chat/message-row.tsx`: "Reply" becomes "Quote", "Reply in thread" becomes "Open thread". Composer chip reads "Quoting <name>".
- Touch screens: the toolbar is hidden today (`[@media(hover:none)]:hidden`). Add a visible "More" button per message that opens an action sheet (Quote, Open thread, React, Pin, Copy). Phase 5 reuses it.
- Clicking a quote whose original is not loaded fetches the page around it instead of doing nothing.

### L. Room description

No new column: `discussion.goal` (1000) and `context` (8000) already hold this.

- Show the first line of the goal under the room title in the header; a click opens the details.
- Render goal and context as Markdown (clickable links) in the details.
- "New room" form gains "More about this room (optional)", saved to `context` (today it always sends `""`).
- Labels: "Goal" becomes "What this room is for"; "Room context" becomes "Details and references (bots read this)".
- Editing moves from the drawer to a room settings page; the drawer stays read-only.

### G. Organization chart is understood

- Start screen (`features/org/org-start.tsx`): add "Draw it from my teams", which drafts seats from current teams, leads and bots for the admin to adjust.
- **"Works with" layer:** a URL toggle (`show=links`) that draws dotted lines between bots that share rooms, workflow steps or decision handoffs. Server: one read endpoint in `apps/server/src/modules/org/` computed from existing tables. This is the "agent correlation" view the client asked for.
- Links into the chart: bot settings "Organization" section and the chat details panel show "Reports to X · See on the chart" (`/organization?focus=`).
- One sentence at the top of the page saying what the chart changes (bots read their seat, escalation follows it), plus a page in `docs/wiki/user-guide/`.

### H (part 1). Calendar is findable

- Move Agenda out of the sidebar group that Simple navigation hides (`components/app-sidebar.tsx:51-62`) and label it "Calendar".
- Empty state on the Agenda page: "Connect Google Calendar", leading to the guided steps in `features/plugins/google-connect.tsx`, with a "Test" button at the end.

## Phase 2 — Self-hosted models that work

Finding: `packages/harness/src/models.ts` lists CLI engines only. Nothing in Zetta stores a base URL or model name for a bot's model. `docs/verification/e2e/engines.md` records 3 engines passing and 5 skipped. Only Claude Code has a live-progress parser.

1. **Ask the client** which model server, which engine and what they saw. One message; work starts without waiting.
2. **Reproduce.** Extend `scripts/e2e/engines.ts` with a local OpenAI-compatible server (Ollama) driven through `opencode`, covering a plain answer, a `zetta:*` tool block, and an error.
3. **First-class setup.** A per-user connection of provider `compatible` (address, model name, optional key) in `apps/server/src/modules/connections/service.ts`, following the speech-to-text `compatible` provider and its private-network rule. Zetta writes the engine's provider config into the per-user engine home (`ZETTA_HARNESS_HOME_ROOT`), so nobody edits files on the server. Engine: `opencode`, confirmed against its documentation before coding.
4. **UI.** Engine step of the wizard gets "A model on my own server" with a "Test connection" button that runs one real turn.
5. **Tool blocks from small models.** Measure in step 2 first, then fix what fails in `apps/server/src/modules/chat/tools.ts` (tolerant fence parsing, one repair retry).
6. **Errors the owner can act on.** Today the CLI's text is always hidden (`chat/harness.ts:684-704`). Show a cleaned detail line to the bot's owner.
7. **Live progress** parser for the chosen engine in `chat/harness.ts`.
8. Update `packages/core/src/maturity.ts` and the e2e report with what the run proves.

## Phase 3 — Missing basics

### J. Edit messages

- **Data:** `message.edited_at` plus a `message_revision` table that keeps every earlier text (nothing is lost).
- **API:** `PATCH` on a message in `chat/routes.ts` and `discussions/routes.ts`. Only the author, only their own `user` messages, never messages from outside channels or bots.
- **Bots:** an edit does not start a new turn. The bot reads the new text on its next turn. A message still queued is simply replaced.
- **Copies that would go stale:** refresh `meta.quote.excerpt` on messages quoting it (same conversation, same transaction); mark the rolling summary (`chat/summary.ts`) for refresh; saved memory copies stay as they are.
- **Live:** publish the existing `conversation:<id>` topic.
- **UI:** "Edit" in the message actions, Up arrow in an empty composer edits the last message, inline editor is `MentionTextarea`, an "edited" mark opens the earlier versions.
- Not included: deleting a message, and "edit and ask again".

### K (part 2). Quote a part

Select text in a message and choose "Quote selection". The API takes an optional excerpt and accepts it only if it is found in the quoted message (500 chars).

### F. Profile fields

- **Fields:** job title, department, about, timezone, contact line. Stored beside the avatar in `user_preference`, changed only through `PATCH /api/profile` (`apps/server/src/modules/profile/`).
- **Shown** through a new `PersonIdentity` (name + job title) in team people, org palette and seat holder, project members, task assignee; a click opens a small profile card. Falls back to the seat title when the person has not written one.
- **Used:** bots receive the person's title with the name (as untrusted data); the timezone becomes the default for new routines. The Chief's `profile` tool gets the same fields.
- A `/people` list of members with these fields.

### M. Update available

- **Version:** the build stamps commit and commit date into the server (`install.sh`, `apps/server/Dockerfile`). Shown in Studio > Overview and Preferences so a report names its build.
- **Check:** a daily server job compares the build date with the published `changelog.json` of the landing site. No identifier is sent. An installation setting (`on | off`) and an operator env fallback turn it off.
- **Endpoint:** signed-in only (`/api/installation/version`), state `current | behind | unknown`. `/api/meta` stays without a version, as its rule says.
- **UI:** admins get a quiet "Update available" mark and a Catch up card, opening a page with the changes since their build and the one update command. `docs/operations/upgrade.md` documents it.
- Not included: release tags and desktop auto-update.

## Phase 4 — Voice mode

Bots run one process per turn and work in text, so the plan is a spoken loop around the normal turn. A realtime speech-to-speech model would lose tools, memory and approvals.

1. **Portuguese first.** The local model gets about half of Portuguese right (`docs/verification/e2e/voice.md`). Test a larger local model and a provider with `scripts/e2e/voice.ts`; voice mode ships only with a setup that passes.
2. **Speech out.** Installation setting `off | browser | openai | compatible | elevenlabs`, built like the speech-to-text setting (`apps/server/src/modules/transcribe/`, sealed admin key). `browser` needs no setup.
3. **"Listen" button** on any bot message. First visible result.
4. **Voice mode in a one-to-one chat:** listen, detect the end of speech, transcribe, send, speak the answer sentence by sentence as it streams, listen again. Talking over the bot stops it.
5. The turn is marked as spoken so the bot answers short and without tables or code.
6. Approvals are announced and wait on screen; nothing is approved by voice.

## Phase 5 — Mobile

Path: make the installed web app a good phone app with real push. Store apps are a later decision (developer accounts, a native wrapper).

1. **Push:** keys created at install, a `push_subscription` table, a `push` handler in `apps/web/public/sw.js`, and a server sender raised from the same points as attention cards. Per-user choice: `all | mentions_and_approvals | off`.
2. **Touch pass:** the message action sheet from Phase 1, safe-area insets, a bottom bar (Chats, Rooms, Catch up, Tasks, More), composer above the keyboard, 44 px targets.
3. **Install:** "Install on your phone" in Preferences beside the QR pairing, with the Android prompt and the iPhone steps.
4. **Real devices:** iPhone Safari and Android Chrome, reported in `docs/verification/e2e/`.

## Phase 6 — Integrations

### I. Figma

Native plugin in `apps/server/src/modules/integrations/plugins/figma.ts`, shaped like `canva.ts`. First version signs in with a personal access token (sealed field). Tools: read a file's structure, read a frame, render frames to images saved as artifacts, list comments, post a comment (approval card). Operations page in `docs/operations/`.

### H (part 2). Calendar depth

- Add to `plugins/google/calendar.ts`: update and delete an event, free/busy, choose a calendar, invite guests (approval card, since it sends mail to others).
- A read-only path with no Google Cloud setup: paste a calendar's private ICS address and Agenda imports it.

## Rules that apply to every phase

- Every schema change ships with its migration, applied to dev after a backup, with no data lost.
- New options are string enums, ids are UUID v7, lasting logic stays in app code.
- Configuration lives on pages; drawers only show quick information.
- Every new user action gets its Chief and MCP tool (`docs/decisions/bot-parity.md`).
- No Beta labels: an unsure feature gets a test of its use against the requirement.
- Each phase adds or updates a decision doc in `docs/decisions/`.

## Verification

Per phase, before it is called done:

- Server tests on the bundled Postgres (`ZETTA_TEST_DB=embedded`, run under `timeout`); web tests; `tsc`; `vp lint`; format only the touched files.
- A real-browser pass with screenshots through `scripts/e2e/`, at desktop width and 390 px, signed in as a member in Simple mode.
- Phase 1 has a specific test: a new member in Simple mode opens bot settings and the routine form and sees none of the advanced labels until "Advanced" is opened.
- Phase 2: `scripts/e2e/engines.ts` against a real local model; Phase 4: `scripts/e2e/voice.ts` in Portuguese; Phase 5: two real phones.
- The report for each run goes in `docs/verification/e2e/`, stating what was and was not checked.

## What to tell the client now

- Org chart: sidebar > Organization. Quote: hover a message > Reply. Calendar: Plugins > Google, then Agenda.
- GPT: sign in the Codex CLI or Codex app on the server.
- Coming, in this order: clearer screens and bot roles, self-hosted models, message editing and profiles, voice mode, mobile.

# What a person can do, and what a bot can do about it

Checked on 2026-11-15: every feature a person has in the web app, against the tools a bot has (`zetta:<kind>` blocks, the Chief's `zetta:*` setup tools, and the Zetta MCP server). Rule going forward: **a feature that a person has ships with its bot tool**, or is written down here as human-only on purpose.

A bot tool never skips a person's decision. A change a bot asks for is a card the person approves (the Chief's setup tools), or it applies at once only where it is the bot's own work (its tasks, its memory, its own routines).

## Added on 2026-11-15

| Feature                   | Tool                                                                                            | Notes                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company chart             | `zetta:org` (Chief and the administrator's own bots), MCP `*_org_*`                             | Admin only; see `organization.md`.                                                                                                                                              |
| Projects                  | `zetta:project` (Chief)                                                                         | list, get, create, update, members, rooms, add_work. Only the owner changes a project. Other bots do not read projects: they already get the brief of the projects they are on. |
| People of a team          | `zetta:team` add_people, remove_people, get                                                     | Never remembered by "Always allow".                                                                                                                                             |
| Display settings and name | `zetta:preferences` update, profile                                                             | `approvalMode` is not offered. The picture and the email do not change here.                                                                                                    |
| Workflows                 | `zetta:workflow` get, update                                                                    | The graph is checked before the card. There is no delete, in the web app either.                                                                                                |
| Routine triggers          | `zetta:routine` get, trigger_add, trigger_pause, trigger_resume, trigger_remove, trigger_rotate | A Gmail or Home Assistant trigger is a card. A **webhook and a new webhook secret open a form**: the secret is shown only in the person's browser, never to the bot.            |

## Added later on 2026-11-15 (improving a bot, memory, workflows, channels)

| Feature                                                        | Tool                                                                  | Notes                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Earlier chats                                                  | `zetta:chats` search (every bot)                                      | The asker's own chats only; see `conversation-memory.md`.                     |
| Bot history, numbers                                           | `zetta:bot history`, `stats` (Chief, read), `restore` (Chief, a card) | A restore is a new version. See `bot-improvement.md`.                         |
| Workflow steps `approval`, `wait`, `for_each`, `tool`, `retry` | `zetta:workflow update` (same graph schema)                           | A write `tool` step must follow an approval step. See `workflows-v2.md`.      |
| Slack and e-mail channels                                      | Plugin tools `send_message`, `read_thread`, `send_email`              | Only for the chat an outside person wrote from. See `channels-and-inputs.md`. |

| Chat memory settings | `zetta:bot update` with `contextBytes`, `summaryMode`, `summaryMaxChars`, `summaryGapBytes`, `chatSearchLimit` (Chief) | A card each time; they are part of the bot's versions, so History lists them and a restore brings them back. See `conversation-memory.md`. |

## Added on 2026-11-16 (bot role)

| Feature                                                                                                                                     | Bot tool                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot role (one line, 60 characters at most, shown beside the name in every bot picker, the `@` list, the task assignee row and the org seat) | `zetta:bot update` with `role` (Chief); `zetta:bot list` and `get` show it, with the line the web falls back to (`botRole`: the role, else the description's first line, else Chief or Specialist) | A card each time, like the other fields. `role` is **not** part of the bot's saved versions (`snapshotConfig`): adding it would change the config hash of proposals already waiting, so History does not list it and a restore leaves it as it is. |

Human only, on purpose, from the same change: **the speech-to-text provider and its key** (administrator only: the key is typed in the web app and sealed, never through a bot; the Chief's installation card shows the form, nothing more), **ratings** (thumbs on a reply: a bot must not rate itself), **saved tests** (a person chooses what to ask again), and the **workflow approval card** (`workflow_gate`, never remembered).

## Human only, on purpose

- **Secrets and sign-ins**: API keys, plugin keys, source logins, machine secrets, webhook secrets. A bot opens a form (`zetta:setup`, `zetta:connection`, the triggers form); the person types or reads the secret.
- **Approving a card**, and **how risky cards are approved** (`approvalMode`): a bot must not decide its own approvals.
- **Invitations and installation settings**: the Chief opens the form for the administrator.
- **Changing the profile picture**: an uploaded image would pass through the model.
- **Deleting a workflow**: nobody can, yet.
- **Editing a person's message**: only the author, in the web app. The MCP server has no message tools, and a bot that rewrote what a person said would change the record of the conversation. See `message-edit-and-quote.md`.

## Known narrow spots, not filled

- Tasks: only the Chief removes a task (a card). Other bots add, update and plan their own.
- Workflows: bots cannot run a workflow they did not propose; the Chief runs, reads and edits.
- Skills: other bots can search and install (card); the Chief manages the library.
- Apps: a bot builds and updates apps; the tool policy and per-bot assignment are the person's.

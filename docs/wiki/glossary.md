# Glossary

[Wiki home](README.md)

> **Status:** terms for the intended v1. Names explain the product model; they do not establish an implemented API or final UI labels.

## Everyday terms

| Term            | Meaning                                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot             | An assistant configured for a job. Sharing its definition does not share your accounts or conversations.                                                                                                                                                                                     |
| Personal chief  | Your one coordinating bot. It can assign work to specialists; it does not have extra authority over your data.                                                                                                                                                                               |
| Specialist      | A bot with a focused job. You can talk to it directly or use it through your chief.                                                                                                                                                                                                          |
| Folder          | A visual group of bots, including optional inner groups. It does not change access or create another chief.                                                                                                                                                                                  |
| Team            | A named group of bots with one chief, and the people who can read its rooms. The owner adds the people. Team-visible bots and published snapshots go to every active installation member instead, not just to a team. A visual workspace is separate from a team.                            |
| Room            | A shared conversation where bots work on a task together. A room of a team can be read by every person of that team; only its owner posts for now.                                                                                                                                           |
| Connection      | Your access to an external account or service. A bot uses your authorized connection, not a teammate's login.                                                                                                                                                                                |
| Onboarding      | Setup, a real conversation, the bot's satisfaction question, and your explicit positive confirmation.                                                                                                                                                                                        |
| Ready           | The tested setup is confirmed for you and the bot, and technical prerequisites remain valid. Access is still checked when work starts.                                                                                                                                                       |
| Task            | The work you ask a bot to do. It can involve several bots or execution attempts.                                                                                                                                                                                                             |
| Result          | Retained output from work, with an authorized link. It can be complete or partial.                                                                                                                                                                                                           |
| Attention item  | A source-linked request for input, repair, or review. Reading it does not perform the requested action.                                                                                                                                                                                      |
| Routine         | A saved task or published workflow that runs on a schedule.                                                                                                                                                                                                                                  |
| Workflow        | Connected bot tasks and conditions that determine which steps run. A routine can schedule it.                                                                                                                                                                                                |
| Memory item     | One thing the bots know: a fact, a note a bot keeps for itself, a profile detail, a reusable method (tagged instruction) or the text of a Drive document. It has tags, a how-to line (when to use it), a score (how important), who can read it, and links to other items that form a graph. |
| Notes           | What a bot keeps for itself (a memory item only that bot reads, tagged note) and who you are (a memory item tagged profile). Both are shown in every prompt without a search.                                                                                                                |
| Instruction     | Not a separate store any more: a reusable method for doing a task is a memory item tagged instruction. It is not a past result or a schedule.                                                                                                                                                |
| Configuration   | A bot's setup and behavior. Bot-proposed changes need a visible diff and explicit approval.                                                                                                                                                                                                  |
| Snapshot        | The entire conversation frozen at publication time for read-only team viewing. It is not a shared live chat.                                                                                                                                                                                 |
| Browser profile | Your isolated browser state, including logins. Sharing among your bots must be explicit.                                                                                                                                                                                                     |
| Takeover        | Temporary human control of an isolated browser/computer session. The bot gives up input and observation during sensitive entry.                                                                                                                                                              |

## Technical terms

| Term              | Meaning                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Harness           | The installed execution tool behind a bot, such as Pi or Codex. Capability and account setup differ by harness.                          |
| Model             | The selected model used through the harness; a model selection alone does not prove a working setup.                                     |
| Run / attempt     | A durable execution request / one attempt to perform it. Reconnecting to a run is not a new attempt.                                     |
| Actor             | The user whose authority and connections an execution carries. For scheduled work, this is the routine owner.                            |
| MCP               | An integration protocol for exposing tools and context. A server's permissions and data access still require review.                     |
| Hook              | Configured logic around model calls that can change context, redact, stop, or enqueue owned work without changing user authority.        |
| Decision provider | An external component used for bounded decisions; Jev and Laya are required integration targets whose exact contracts need verification. |
| Host-tool bridge  | A controlled path for a harness to call Zetta-owned tools with the current run's authority. A model cannot choose a different actor.     |

For rules, use [privacy and sharing](user-guide/privacy-and-sharing.md) and [execution and access](architecture/execution-and-access.md). For implementation status, use the [backlog](../../TASKS.md).

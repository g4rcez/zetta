# Fluid chat: a message reaches the bot while it works

Built 2026-11-19.

## Problem

A message sent while a bot worked was saved as "Waiting" and answered by a second turn, after the reply in progress ended. The badge said the bot would read it "at its next step", but that only happened between Zetta tool rounds. A Claude Code bot that uses its own tools runs one process whose input was closed, so it read nothing until it finished. People had to wait, press "Send now" (which killed the work in progress), or choose a Park/Interrupt preference. The chat felt like a ticket line.

## Decision

A running reply has an **inbox**: what a person sends while it runs. The reply reads its inbox at every point where it safely can, and the queue is no longer something the person sees or operates.

- The bot starts on the first message at once. There is no wait and no typing detection.
- A later message reaches the bot at its next step. A running command is never cut. Only Stop (the button or the word) cuts.
- One answer covers every message. A correction redirects the work; a separate quick question gets its answer at once while the work goes on (Claude Code only).
- If the bot has not done anything yet, a new message starts the run again with all messages in one prompt, so the person gets one answer (Claude Code only, at most 8 times per reply).
- It applies in a 1:1 chat, in rooms (a person's posts addressed to the bot) and in outside chats (WhatsApp, Telegram, Slack: what the same chat sends). It also applies to runs the server started in a chat: a goal loop step, a routine run, a resumed or retried run.
- Out of scope: API and MCP clients (a busy chat still answers 409 on `/stream` and `/messages`), identical behaviour on every engine, any debounce.

## Read points

Fastest first. Each message is read once, by the first point that reaches it.

1. **Inside a Claude Code run.** The CLI runs with `--input-format stream-json --replay-user-messages` and an open stdin (`claudeArgs`, `streamCli` in `chat/harness.ts`). A message is written as a user line. The CLI holds it until the running tool calls end, then the bot takes it. The CLI prints the line back when the bot takes it, which is the read receipt (`{ read }` in `chat/claude-stream.ts`). What this relies on was checked against the installed CLI: `scripts/e2e/claude-live-input.ts`, report in `docs/verification/e2e/claude-live-input.md`. The setting `claudeLiveInput` (Studio > Server settings) set to off turns it off.
2. **Between Zetta tool rounds.** `rerun` in `finishReply` (`chat/service.ts`), as before.
3. **Before a reply closes.** `handOver` in `finishReply`: the inbox is read once more. If it holds a message from a person, the bot gets one more round with its reply so far and the new messages, and that round's text is added to the same reply. At most 5 per reply. This is how a message reaches an engine that cannot read one mid-run, and how one that arrives just as a run ends is not left for a second reply.
4. **After the turn.** `drainQueue`, as before. It is the safety net: a crash, a restart, the limits above, and messages that keep a turn of their own.

A **poke** (`chat/poke.ts`) tells a running reply that its inbox changed, so read point 1 reacts at once. It is only a hint, keyed by the turn's abort signal. A lost poke loses nothing: the message stays saved and the next read point takes it. A room post can be served by a process that runs no turns, so there the poke travels as a work kick of kind `poke` (`events/work.ts`).

## What a message goes through

`chat_queue` is still where a message sent to a busy chat is saved, in the same transaction as the message. It is now the durable inbox, not a line the person watches.

- `pending`: not read yet. Read points 2 to 4 take it (`claimNotes`: the row is deleted and the message gets `meta.steer = { replyId }`).
- `sent` (new, read point 1 only): written to the running CLI, not read yet. `liveNotesFor` in `chat/service.ts`:
  - when the bot takes it, the message gets `meta.steer`; the row stays, because the answer is not written yet;
  - when the run ends with an answer, the rows of what it read are deleted, and what it never read goes back to `pending` for read point 3;
  - when the run fails or is cut off, everything it was sent goes back to `pending` and loses its mark, so the next turn answers it.
- A message that cannot be read as a note keeps a turn of its own, and so does every message sent after it in the same thread (none is read before an earlier one): a picture, a file or file reference, picked memory or skills, a poll, another bot named in it, a `/command`, "remember that ..." (`ownTurn`, `pickNotes`, `actsOnRawText`). The page says "The bot reads this when its current reply ends" under it.
- `held` is no longer written. Rows an older Stop held can still be sent or removed.

No migration: `chat_queue.status` is a text column with no check. `user_preference.steer_mode` is no longer read and stays in the table.

## Where the reply sits

A reply that reads a message sent after it started moves below that message (`moveToEnd` in `chat/messages.ts`: its `seq` becomes the newest; only a `running` row moves). The answer is then the last thing in the chat, and the next turn reads the two in the order they happened. Two readers changed because of it: the history of a queued turn (`converse`: it no longer cuts at `seq < asked.seq`) and the idempotent replay (it skips messages the reply read).

## Rooms

- A person's post that queued a turn for a bot that is already running there is addressed to that bot. Its running turn reads it (read points 1 to 3), and when that turn is done the queued turn ends as `skipped` / `read_in_turn` (`waitingPosts`, `skipRead` in `discussions/store.ts`), so the post is not answered twice.
- A post with a picture, a file, picked memory or skills, a poll or a quote keeps its own turn.
- What other bots post is read between rounds, in turns, as before, and never gives a bot an extra round.

## Outside chats

A turn for outside people gets `external.later` from `inbound/service.ts` (`claimLater`): the pending events of the same chat become one more message of the conversation, marked as read by the running reply, and are given to the bot as a data block (`inboundLater`), never as instructions. A claim counts toward the hourly caps like a turn. When a turn ends, what arrived too late for it is delivered at once (`deliverConversation`). Outside chats use read points 2 to 4 only: the bot answers them in a tool round.

## Stop

Stop deletes the queue rows of the messages the bot had not read (`chat/stop-work.ts`). The messages stay in the chat as what was said, with no state and nothing to press, and nothing answers them on its own. When the person writes again, the bot sees them as earlier messages.

## Lessons

A message added while a reply was written counts against that reply only when it reads as a correction (`looksLikeCorrection`, `learning/outcomes.ts`). Before, every such message was a `steered` signal (weight -2), which would count normal chatting as a complaint. No new signal was added: `reply_outcome.signals` has a check on the list, and a message that only adds to the request simply leaves none.

## Removed

- The "Waiting" text, "Send now" and "Remove" on a waiting message, the "Queue a follow-up" placeholder.
- `POST /api/conversations/:id/interrupt`, `ChatService.interrupt`, and the "You were working on the request before this one" prompt.
- The Park/Interrupt radios in Preferences, `steerMode` in the preferences API and in the Chief's `zetta:preferences` block.
- "Used by the bot at its next step": the read mark of the message (`seenBy`) says it.

## Checked

- **The CLI behaviour this relies on**, against the installed Claude Code 2.1.328: `scripts/e2e/claude-live-input.ts` (report `docs/verification/e2e/claude-live-input.md`). A message written during a 12 s command is read right after it, the command prints its last line, one answer covers both, the read receipt carries our id, a message after an answer gets a second answer from the same process. The same script runs Zetta's runner against the CLI, including a side question answered ("Paris") 12 s into a 25 s task.
- **The chat service with a real model**: `scripts/e2e/fluid-chat.ts` (report `docs/verification/e2e/fluid-chat.md`). Five messages 1.5 s apart got one reply, "APPLE, MANGO, CHERRY", the replaced word left out. A correction sent 8 s into a 15 s command was read when the command ended and the file held the corrected word. Stop with an unread message left the reply cancelled and the message unanswered.
- **The page, in the Helium browser** on an isolated stack with a stand-in engine that works for 14 s: no waiting text and nothing to press on a message sent meanwhile, the composer reads "Add to your request…", Stop stays, and afterwards both messages carry the read mark with the one reply below them. Screenshots: `docs/verification/e2e/fluid-chat-working.png`, `docs/verification/e2e/fluid-chat-done.png`.
- **Tests**: `chat/durability.integration.test.ts` (read before the reply closes, live read, a run that never reads, a run that breaks, the early restart, a message that keeps its own turn, Stop, a server-started run), `chat/harness.test.ts` and `chat/claude-stream.test.ts` (a stand-in CLI that reads stdin), `chat/queue-batch.test.ts`, `chat/poke.test.ts`, `discussions/discussions.integration.test.ts`, `inbound/inbound.integration.test.ts`, `learning/learning.integration.test.ts`, and `apps/web/src/features/chat/message-row-queue.test.tsx`.

## Limits

- Telegram is polled every 20 to 60 seconds, so a first message there still starts late. WhatsApp and Slack push.
- Engines other than Claude Code react when their run ends (read point 3), not at the next step, and never start again for an early message: they report no steps, so Zetta cannot tell that no command is running.
- A Claude Code run inside a Zetta tool round (a round after the first answer) reads late messages when that round ends.
- A reply that moved below a message keeps the time it started.
- Not checked: live input under `docker run -i` (the flag is passed; no run was made with the bot image).

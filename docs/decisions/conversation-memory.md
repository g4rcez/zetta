# Conversation memory

Decided and built on 2026-11-15, after the product report found that a bot reads back only about 2,000 tokens of a chat.

**The cause.** Every turn starts a fresh process (`chat/harness.ts`). The bot sees what the server puts in the prompt: the newest messages of the chat that fit a byte budget (`chat/context.ts`, `buildHistory`), plus memory and notes. `CONTEXT_BYTES` was 8,000, the same for every bot.

**What was decided.** Summary, search and a bigger per-bot budget. Resuming the engine's own session was left out on purpose: the research found twelve ways it breaks (a different working folder on every non-code turn, a temporary home folder in Docker, tool rounds that are not in the session's transcript, thread scoping, duplicated context, fallback engines). It is the better saving, and a separate project.

## The budget

- `bot.contextBytes` (nullable integer, 4,000 to 60,000, database check). Null is the default, **24,000** (`CONTEXT_BYTES_DEFAULT`). The limits live in `chat/context.ts` and `packages/db/src/schema/chat.ts` and a test keeps them equal.
- The prompt is one command-line argument of about 128 KiB that memory, notes and the tool text share, which is why the top is 60,000 and not more.
- `pipeline.ts` passes `contextBudget(bot)` to `buildHistory`. The history query clips each row at the largest budget; the turn applies the bot's own.
- Setting: Setup tab of the bot, "Chat memory" (see "Controls" below). Part of the bot's saved versions (History).

## The summary

- Table `conversation_summary` (one row per chat, bot and thread; only the main line is summarised, a thread is short and read whole). `through_seq` is the last message it covers.
- `chat/summary.ts`: when a turn ends (`afterTurn`) and at least **2,000 bytes** of the chat fell out of view since the last summary, a refresh is queued. A job on the 30-second ticker (`chat:summaries`) writes it with the owner's chief engine (`createOneShot`): the old summary plus the newly cut messages in, up to 2,000 characters out. After a failure it waits 15 minutes.
- The turn reads it once (`retrieval.summary`, shared by the first answer and every tool round) and puts it **before** "Conversation so far", only when something was cut, framed as data written by the system that may be incomplete.
- Not summarised: chats with outside people, rooms, threads, a bot whose engine is the practice engine or the decision model, and a chat that holds something that looks like a key (it is not sent to the engine, and a summary that looks like a key is dropped). With an active redact hook the summary is not sent (the hook cleans the messages it shows; the summary was written from the raw ones).
- Known gap: the summary covers up to the cut point of its last refresh, so a few messages between that point and the current cut can be in neither view until the next refresh (bounded by the 2,000-byte threshold).

## Controls (2026-11-15, second pass)

The four presets were not enough, so every number of the feature is a per-bot setting (columns of `bot`, null = the default, CHECKs in the database, the same limits in `chat/context.ts` and `@zetta/core/chat-memory` that the web form validates against; `summary.test.ts` keeps all three equal):

| Setting           | Meaning                                                                                      | Default and range                                                        |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `contextBytes`    | History read back each turn                                                                  | 24,000; 4,000–60,000, **typed freely** (presets stay as shortcuts)       |
| `summaryMode`     | `chief` (the owner's Chief engine writes it), `bot` (this bot's own engine and model), `off` | `chief`                                                                  |
| `summaryMaxChars` | Length of the summary                                                                        | 2,000; 500–6,000 (the `conversation_summary` CHECK was relaxed to 6,000) |
| `summaryGapBytes` | How much must fall out of view before a refresh                                              | 2,000; 500–20,000                                                        |
| `chatSearchLimit` | Hits `zetta:chats` returns; also the most the bot may ask for                                | 6; 1–10                                                                  |

- The refresh job reads the bot's settings when it runs, not when it was queued: turning the summary off cancels a refresh that was waiting, and a summary the bot already has is kept and read again if it is turned back on. `off` is not the same as deleting.
- `bot` mode passes the bot's id to `createOneShot`, which then uses that bot's harness and model (it must be the owner's and not archived).
- **A freely chosen size cannot break a turn.** Nothing used to check the whole prompt. Now `pipeline.ts` builds the turn text with a placeholder for the conversation, measures everything else (the system text too when it travels in the prompt: every engine but Claude Code, or Claude Code past `SYSTEM_FLAG_MAX_BYTES`), and `fitHistory` drops the **oldest** messages until the whole is under `PROMPT_MAX_BYTES` (120,000, a little under Linux's 128 KiB for one argument). If even the newest message is too big it is clipped. The cut shows as "earlier messages omitted".
- Clipping is by bytes and never splits a character (`clipBytes`); a huge Chinese or emoji message used to be cut by characters and could be three times the budget.
- The form speaks bytes and shows about how many tokens that is (÷4, English; other languages use more). `cutPoint` still counts 12 bytes of overhead a message (a little more than `buildHistory`'s `role.length + 3`), which only makes the summary start a little earlier.
- The Chief can read and change all five through `zetta:bot update` (a card); `get` shows them. They are part of a bot's versions, so History lists them and a restore brings them back.
- Out of scope: a per-bot choice of the summary's model apart from its engine; counting real tokens (bytes ÷ 4 is an estimate).

## Searching earlier chats

`zetta:chats {"action":"search","query","bot?","since?","limit?"}`, for every bot. Always the asker's own chats (never the bot owner's). Left out: the chat it is in, archived chats, outside people's chats, rooms, routine and memory-job chats, and the chats of saved tests. Hits come back as untrusted data with the chat's title and date. Inbound turns drop the tool (they only keep their reply tool). The Chief's preamble cap in `tool-preamble.test.ts` was raised for it.

## Limits

- No embedding of messages: search is full text (`simple` dictionary, accents folded). Memory items remain the place for lasting knowledge.
- The summary is per bot and chat; a chat with several bots keeps one per bot.

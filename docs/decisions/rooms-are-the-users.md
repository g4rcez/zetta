# Rooms are the user's

## Problem

Bots opened visible rooms by themselves (for example `zetta#27: bump components` for a pull request). A bot with pre-approved peers (`bot_peer`) opened one at once with `zetta:discussion open`, and the tool text told bots to "open a room with them instead of answering alone". The Rooms list filled with rooms the person never made, and the bots talked there instead of in the chat or in the rooms the person made.

## Decision

- **Rooms belong to the person.** A visible room (`discussion.kind = 'room'`) is made by the person: the + button, a team, an `@mention` of a bot in a chat that is not its own (`redirectMention`), a card the person approves, or their own message asking a bot for a room ("open a room with Dev", "abre uma sala", see `asksForRoom` in `chat/intent.ts`).
- **A bot that decides alone opens a hidden bot room** (`kind = 'bots'`), and only with pre-approved peers. It is not in the sidebar. It shows in All rooms > Bot issues and from the receipt in the chat that opened it. Other bots still need the person's card, and a room approved on a card is a plain room.
- **Contact stays in official rooms.** The request is refused, with the room's name and id, when an open room of the person already has the bot and every bot it invited. The bot posts there or mentions them in the chat.
- **Limits.** 2 open bot rooms per bot, 6 per person (`MAX_BOT_ROOMS_PER_BOT`, `MAX_BOT_ROOMS` in `discussions/store.ts`). A resolved room frees its place.
- **Prompt.** `openToolText` (`discussions/prompt.ts`) tells bots rooms are the user's, to keep the talk in the chat, and to open one only for something very specific and important.
- Unchanged: the Chief's help and permission rooms, inbound chats (still only pre-approved bots, never a card), team rooms.

## Not done

- Rooms that bots already opened stay as they are (visible). The person can delete them, or the Chief can.
- "Very specific and important" is a prompt rule plus the limits above; the server cannot judge importance.

## Where

`discussions/store.ts` (`request`), `chat/service.ts` (`runDiscussionTool`, `ToolScope.askedForRoom`), `chat/intent.ts`, `discussions/prompt.ts`, `packages/db/src/schema/discussions.ts` (`kind`, a text column: no migration), `apps/web/src/features/discussions/rooms.ts` (sidebar grouping).

## Seeing the work in a room (2026-11-14)

A running room turn showed only "Thinking · 17m" and "<bot> is working…". The turn streams like a chat's, but a page that does not follow the stream (more than 3 running turns, a read-only viewer, a reload, a dropped stream) reads the saved `running` row, and that row held no steps: only `content` was flushed, and a Claude Code bot streams steps, not prose, so `content` stayed empty. Now `runAnswer` (`chat/service.ts`, `saveLive`) saves `meta.timeline` and `meta.activity` on the running row at most every 3 s (the same write keeps `harnessSession` for crash resume), and for a room turn publishes `topics.conversation` so the page reads again at once (the poll slows to 15 s or more while the live channel is up). The web row reads `row.meta.activity` and `row.meta.timeline` (`work-timeline.tsx`, `message-row.tsx`). Not done: output of a step is still only offered on a live row; a room shows at most 3 live streams.

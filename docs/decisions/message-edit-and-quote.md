# Editing a message, and quoting a part of one

Built for the client feedback plan (`plans/feedback.md`, items K part 1, J and K part 2).

## Quote is findable

- "Reply" is now **Quote** and "Reply in thread" is **Open thread**, in the toolbar, the menus and the composer chip ("Quoting <name>").
- A screen that cannot hover (`(hover: none)`) has no toolbar, so every saved message shows a visible **More** button (`features/chat/message-actions.tsx`). It opens an action sheet: Quote, Open thread, React, Pin, Copy, Edit (the person's own messages), the rating of a bot's answer and Save to memory. Phase 5 reuses the same component.
- A quote whose original is older than the loaded page fetches the page around it: `GET /api/conversations/:id/messages?around=<messageId>&before=<seq>` returns the messages from 25 before the original up to where the loaded list begins, so the two pages join without a gap. The page keeps them while the conversation is open (the live refetch only replaces the newest page), scrolls to the message and flashes it. In a room the same hook is used (`features/discussions/use-room-messages.ts`).

## Editing

- **Data:** `message.edited_at` and `message_revision` (every earlier text, nothing is lost). No new column.
- **API:** `PATCH /api/conversations/:id/messages/:messageId` (chat, up to 32768 characters) and `PATCH /api/discussions/:id/messages/:messageId` (room, up to 4000, the room's owner). Body `{ content }`. The answer is the message in the shape of the list. `GET .../messages/:messageId/revisions` (chat route, also for a room's conversation) returns the earlier texts, newest first, to the author only.
- **Who and what:** only the author, only `role = user` messages written in Zetta. Never a bot's reply, a system line, a message from a channel plugin (`meta.inbound`), a message in an `inbound` conversation, or a poll (its text is the poll's question). A message of another conversation is 404.
- **One transaction** (`chat/message-edit.ts`): the old text goes to `message_revision`; `content` and `edited_at` change; the quotes of the message in the same conversation get the new `meta.quote.excerpt`; the rolling summary is marked stale when it covers the message; then the existing `conversation:<id>` topic is published (rooms: to the owner and the team's people). Saving the same text again changes nothing.
- **Bots:** an edit does not start a turn and wakes nobody. A message still waiting in the queue is replaced in place (the queue reads the message row); a message a bot already read is not replayed, the bot reads the new text on its next turn. The new mentions are stored on the message (`mentions`, chats only) but nobody is asked because of an edit.
- **Copies that would go stale:**
  - `meta.quote.excerpt` of the messages that quote it is rewritten. A quote that carries a selection keeps its text while the selection is still in the new message, and falls back to the start of the message when it is not.
  - The rolling summary (`chat/summary.ts`): `markSummaryStale` sets a summary whose `through_seq` is at or after the edited message back to `pending` with `through_seq = 0` and `wanted_through_seq` as before. The job treats `through_seq = 0` as "write it again from the start", ignoring the old body, and the old body is still read until the new one is ready. A summary that stops before the message is not touched. A refresh that is already running when the edit arrives may still finish with the old text; the next edit or turn queues it again.
  - Saved memory copies stay as they are.
- **UI:** Edit in the toolbar and in the sheet, the Up arrow in an empty message box (chat, thread and room), the editor is `MentionTextarea` with Save and Cancel (Esc cancels, Ctrl/Cmd+Enter saves), and an "edited" mark after the time that the author opens to see the earlier versions. Everyone who reads the conversation sees the mark; the earlier texts are the author's.
- **Bots, parity:** editing a person's message is human only (see `bot-parity.md`): the MCP server has no message tools, and a bot editing what a person wrote would rewrite what the person said.
- Not included: deleting a message, "edit and ask again".

## Quote a part

- Select text inside a message and a **Quote selection** button appears above it (`features/chat/quote-selection.tsx`). The quote then carries the selection, at most 500 characters. The chip reads "Quoting <name>: <selection>".
- API: optional `quoteExcerpt` beside `quotedMessageId` on `POST /conversations/:id/messages`, `/chat`, `/stream`, `/queue` and `POST /discussions/:id/messages`. It needs `quotedMessageId` (400 without), is at most 500 characters (400), and must be found in the quoted message: otherwise **422 `QUOTE_EXCERPT_NOT_FOUND`**. The quote is saved as `meta.quote = { id, role, botId, excerpt, part: true }`.
- "Found" is checked on the text a person sees, not the raw Markdown: Markdown links keep their label, the marks (`*`, `_`, backticks, `#`, `>`, `@`, list bullets) go and whitespace collapses, on both sides. A selection is copied from the rendered page, so a raw comparison would refuse every message with bold text or a link. The web app only offers the button when the same check passes. The rule lives in `flatten` (server, `chat/messages.ts`) and `features/chat/quote-selection.tsx` (web); keep the two the same.

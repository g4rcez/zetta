# Making a bot better

Decided and built on 2026-11-15. The product report listed four things a person could not do: tell a bot an answer was bad, go back to an earlier version of a bot, try the same questions again after changing it, and see how it does.

## Ratings

- Table `message_feedback` (one per person per reply; `up` or `down`, a reason of at most 500 characters for a thumb down). It copies the bot and its version, so a rating still counts for the version that was rated.
- API: `PUT` and `DELETE /api/messages/:id/feedback`, `GET /api/conversations/:id/feedback`.
- Web: thumbs in the message toolbar of a chat (`features/bot-quality/feedback.tsx`). They **replace the 👍 and 👎 emoji reactions** where a chat gives thumbs (rooms and threads keep the emoji). A thumb down opens an optional "what went wrong?" note.
- A thumb down on a bot that learns (autolearn on, Claude Code or Hermes, the owner's own chat) queues a skill review with reason `downvoted`; the note travels in `skill_review.detail` until the review ends and leads the review's transcript.

## Versions

- `bot_revision` was already written on every change but nothing read it. It now holds the whole configuration (the snapshot gained the fallback engine and model, computer mode, learning, code access, commit identity and the chat memory size). A pending approval card goes stale once when this change lands (cards live 24 hours).
- `GET /api/bots/:id/revisions` (newest first, with the settings that changed from the version before) and `POST /api/bots/:id/revisions/:version/restore {expectedVersion}`. A restore goes through `updateBot` and is a **new version**; history is never rewound. A version saved before this change brings back only what it held (texts, engine, model, visibility, output style).
- Web: History section of the Quality tab, with the text difference from now (`skills/diff.ts`) and a confirmation step.
- Chief: `zetta:bot history`, `stats` (read) and `restore` (a card).

## Saved tests

- Tables `bot_drive_prompt` (at most 10 per bot) and `bot_drive_run`. A run creates a chat with the bot (title "Saved test"), sends the prompt as a turn started by the server (so no learning from it) and records the answer and the version of the bot.
- The chat is hidden from the chat list and from search (`not exists` on `bot_drive_run`, as for routine and memory-job chats).
- Runs go one after the other in the background; the page follows the `bot-quality:<id>` live topic. A second start while one runs is refused (409).
- Web: "Saved tests": each test shows the newest answer and the one before, with the bot version of each.
- A saved test uses the bot's real tools. The page says so; keep them to questions that are safe to ask again.

## Numbers

- `audit_event.duration_ms` is written with each `harness_run` (from the start of the reply). Rows from before are left out of the time figures.
- `GET /api/bots/:id/stats?days=7|30`: answers, finished, failed, stopped; median and slowest-tenth time; how often the person stepped in (answers stopped, steers, approval cards the bot proposed, times it needed the person); ratings.
- Web: Performance section (both periods side by side, so there is no filter to keep in the address).

## Limits

- No evals (scored comparisons): a saved test shows two answers, a person judges.
- No cost per bot (tokens are stored for Claude Code only; see the product report).
- Saved tests and ratings are the owner's; a team member using a shared bot has neither.

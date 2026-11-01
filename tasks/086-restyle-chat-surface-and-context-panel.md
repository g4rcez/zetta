# RFC-086: Restyle the chat surface and add the context panel

- **Module:** Redesign
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-083](083-apply-redesign-tokens-and-contrast-guard.md), [RFC-084](084-rebuild-sidebar-shell-for-chat-first-redesign.md), [RFC-026](026-connect-private-chat-composer-to-runs.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** Two sessions: (a) header, messages, composer; (b) context panel.

## Context and required reading

Read [DESIGN.md](../DESIGN.md) (Chat, Motion, Empty/loading/error states). Other work changes `apps/web/src/features/chat/`; start from its current state. No chat data-model change.

## Goal

The chat reads like Slack with Linear's restraint: a header with the chat switcher, flat message rows, a "Working…" steps block, an inline "needs you" card, the new composer, and a context panel on demand for threads, bot details and files.

## Non-goals

No new chat features, no data-model change, no change to run execution.

## Source anchors and planned changes

- `apps/web/src/features/chat/chat-page.tsx` and its message, composer and thread components.
- `apps/web/src/index.css` (`.chat-*` rules only).

## Contract and implementation steps

1. Header "Bot › Chat title ⌄" with a switcher (the bot's chats, search, "New chat").
2. Flat rows with a 32px avatar, grouping within five minutes, 768px column.
3. Steps block (done, running, failed with icons and text) that collapses to one line at the end of a run.
4. "Needs you" card with an attention tint; the same item is in Inbox.
5. Composer: card, 12px radius, grows to 40% of the panel, `Enter` sends, `Shift+Enter` adds a line.
6. Context panel 360px on the right; a sheet below 1024px.

## Acceptance criteria

- [ ] Long text, code, tables, attachments, streaming, an empty chat and a failed run all render correctly in light and dark.
- [ ] Every state has an icon or a word as well as color.
- [ ] Keyboard: switcher, composer, panel open/close and focus return all work.

## Verification

Focused tests for message grouping logic. Browser screenshots need approval.

## Definition of done

- [ ] Acceptance criteria have evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.

## Completion record (2026-11-01)

**Status: Done.** (Verified 2026-11-01, see the RFC-088 record.) Built; checked in the browser at 1512px in dark mode before the 768px column cap and the 32px controls landed.

- **Header and switcher:** `chat-page.tsx` header is "Bot › Chat title ⌄ ⋯". `thread-tabs.tsx` (the old tab strip) is now the switcher: the bot's chats, "New chat", an "Archived chats" submenu, and a `⋯` menu (Rename, Archive, Delete with the existing Undo). No search field in the switcher: the sidebar filter and ⌘K cover search.
- **Context panel:** one 360px slot on the right (`lg:grid-cols-[minmax(0,1fr)_22.5rem]`); an open thread takes it, otherwise the new Details view (`chat-details.tsx`: bot, status, description, Bot settings, files in this chat). Below 1024px it is a sheet.
- **Messages:** 14px text, 12px labels, sans timestamps with tabular numbers, round people avatars and square bot avatars, a 768px column (`message-list.tsx`, composer wrapper). Trailing action notes fold into one "N actions" line; `📎` (published artifact) and `📋` notes now count as notes (`action-notes.ts`, failing test first).
- **Composer:** 12px radius card, 28px round send button, 14px text.
- **Checks:** `bun test src/features/chat/action-notes.test.ts` 5 pass (new case failed first); web suite `bun test src` 143 pass; `oxlint` clean; `tsc` has no errors in changed files.
- **Not built:** an inline "needs you" card in the message list (the Inbox and sidebar badges carry it); the separate "Working…" block keeps the existing `WorkTimeline`, now in the sans voice.

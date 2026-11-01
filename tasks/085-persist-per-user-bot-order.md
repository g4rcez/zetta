# RFC-085: Persist a per-user bot order

- **Module:** Redesign
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-084](084-rebuild-sidebar-shell-for-chat-first-redesign.md), [RFC-023](023-create-bot-teams-and-sidebar-groups.md)
- **Size target:** One session: one column, the preferences endpoint, the sidebar list.

## Context and required reading

Read the [redesign intent](../docs/intent/redesign.md), [DESIGN.md](../DESIGN.md) (Bot order, Motion) and [ownership decisions](../docs/decisions/ownership.md). Approval is required before the schema change.

## Goal

The user reorders bots in the sidebar by drag or keyboard. The order is saved per user on the server and is the same on every device.

## Non-goals

No order for chats or channels. No shared or team order. The chief always stays first.

## Source anchors and planned changes

- `packages/db/src/schema/preferences.ts`: `bot_order uuid[] NOT NULL DEFAULT '{}'` on the existing per-user `user_preference` row (chosen over a new table: the row, its route, its trusted-origin check and its client already exist). Generate, apply and push the migration.
- `apps/server/src/modules/preferences/`: `GET /api/preferences` returns `botOrder`; `PATCH /api/preferences` accepts it (up to 500 uuids).
- `apps/web/src/features/chat/sidebar.tsx`: `Reorder.Group` / `Reorder.Item` from `motion`.

## Contract and implementation steps

1. Bots missing from the list sort after the placed bots, in the server's order. No data migration is needed and no data is lost.
2. The `PATCH` replaces the person's list in one upsert. A user cannot read or write another user's order. The list holds ids only and only its owner reads it, so an id of a bot the user cannot see reveals nothing and is simply not shown.
3. UI: the new order shows at once; a failed save keeps it on screen and shows an error message. Keyboard: "Move up" / "Move down" in the row menu and `Alt+↑` / `Alt+↓`; a polite live region announces the new position. With reduced motion, the move is instant.

## Acceptance criteria

- [ ] An order set on one device shows on another after reload.
- [ ] A user cannot reorder or detect bots that are private to another user.
- [ ] Keyboard-only reorder works and is announced.

## Verification

Integration test of the endpoint on a scratch database. A UI test for the keyboard reorder logic.

## Definition of done

- [ ] Acceptance criteria have evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] The migration is applied and pushed.

## Completion record (2026-11-01)

**Status: Done.** (Verified 2026-11-01, see the RFC-088 record.) Built and checked on desktop; the phone sheet was not checked in a browser.

- **Changed:** `packages/db/src/schema/preferences.ts`, migration `packages/db/src/migrations/20261101000059_bot_order` (one additive `ADD COLUMN … DEFAULT '{}' NOT NULL`, no data change), `apps/server/src/modules/preferences/{store,routes}.ts`, `apps/server/src/modules/preferences/preferences.integration.test.ts`, `apps/web/src/features/preferences/preferences.tsx`, `apps/web/src/features/chat/bot-order.ts` (new), `apps/web/src/features/chat/bot-order.test.ts` (new), `apps/web/src/features/chat/sidebar.tsx`.
- **Migration:** applied first to a throwaway Postgres (`pgvector/pgvector:pg18-trixie`), then to the dev database; `user_preference.bot_order` is `uuid[]` with default `'{}'`.
- **Tests:** `bun test src/modules/preferences/preferences.integration.test.ts` on the throwaway database: 5 pass (new: an order is kept for its owner only; a non-uuid list and a string are refused). `bun test src/features/chat/bot-order.test.ts`: 7 pass. Server `tsc --noEmit`: clean.
- **Browser:** `Alt+↓` on a focused bot row moved it one place and the list reached the dev database (5 ids); `Alt+↑` put it back. The collapsed rail shows the same order.
- **Behavior notes:** a failed save keeps the new order on screen and shows the existing "Could not save your layout" toast (no rollback). The old per-browser order (`zetta.bot-order`) is moved to the account once, unless the account already has an order when the browser loads.
- **Not checked:** drag with a pointer (only the keyboard path was driven), screen reader announcement (the live region is in the DOM).

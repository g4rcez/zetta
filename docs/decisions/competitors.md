# Sidebar width that sticks + full-width chat

## Context

1. **Sidebar width resets.** Persistence already exists: `PreferencesProvider` (`apps/web/src/features/preferences/preferences.tsx`) caches in localStorage and PATCHes `/api/preferences`, and the server stores `railWidth` in `user_preference`. But the server schema is `z.number().int()` (`apps/server/src/modules/preferences/routes.ts:11`), and `ResizeHandle` sends `start.width + event.clientX - start.x`. Chrome pointer events give fractional `clientX` (for example 231.5), so some saves fail with 400. The dev server log shows this: `PATCH /api/preferences` status 400 at 2026-11-01T00:23:57. When the page loads again, the GET answer replaces the cached width with the old one, so the width "resets". The toast "Could not save your layout…" appears for the failed save.
2. **Chat column is capped at 768px** (`max-w-3xl`). The user wants it to fill the panel.

## Changes

### 1. Round the width before it leaves the handle (root-cause fix)

`apps/web/src/components/resize-handle.tsx`

- Change the local `clamp` into an exported `toWidth(n, min, max) = Math.min(max, Math.max(min, Math.round(n)))` and use it in `move` and `key`. Drag, keyboard, and double-click then always give integers. No server change: the server contract (integers only) stays strict.
- This handle is also used for any `listWidth` resize, so that fix applies there too.

### 2. Full-width chat

- `apps/web/src/features/chat/message-list.tsx:141`: remove `mx-auto w-full max-w-3xl` from the main (non-thread) branch and keep `w-full justify-end`. Update the comment above it.
- `apps/web/src/features/chat/chat-page.tsx:750`: composer wrapper `mx-auto w-full max-w-3xl …` → `w-full …` (keep `px-4 pb-4`).
- Effect: `MessageList` is shared, so room messages in Discussions and the instructions interview also become full width. Their composers have no cap now, so this makes them consistent. Thread panel is not changed.
- `DESIGN.md` lines 264, 284, 371: replace "768px column" with "fills the panel" so the design doc matches. (`DESIGN.md` already has uncommitted edits; I will change only these lines.)

Not in scope: settings pages, discussions room list (`discussions-page.tsx:263`), and cards (`vm-card`, `ui-registry`, `work-timeline`) keep their own widths so they stay readable.

## Tests

- New `apps/web/src/components/resize-handle.test.ts` (bun test, same style as other `*.test.ts`): literal cases `toWidth(231.5, 192, 360) === 232`, `toWidth(100.4, 192, 360) === 192`, `toWidth(400.7, 192, 360) === 360`. Run it first against the current code to see it fail (no rounding), then fix.

## Verification

- `bun test src/components/resize-handle.test.ts` in `apps/web`.
- Type check / oxlint on the changed files.
- Manual (ask before running the dev server): drag the sidebar edge, reload, width stays; dev log shows `PATCH /api/preferences` 200; chat messages and composer fill the panel on a wide screen.

## Risks

- Very long text lines on wide screens are harder to read. This is the trade-off the user asked for.

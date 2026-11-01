# RFC-084: Rebuild the sidebar shell for the chat-first redesign

- **Module:** Redesign
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-083](083-apply-redesign-tokens-and-contrast-guard.md), [RFC-024](024-build-chat-first-navigation-shell.md), [RFC-071](071-define-common-in-app-attention-state.md)
- **Size target:** One or two sessions. Split the rail and mobile sheet into a second session if needed.

## Context and required reading

Read the [redesign intent](../docs/intent/redesign.md) and [DESIGN.md](../DESIGN.md) (Layout, Sidebar structure, Sidebar rows, Motion). Other work changes `apps/web/src/features/chat/sidebar.tsx`; start from its current state. This RFC authorizes no schema/API change.

## Goal

One sidebar on a `--sidebar` ground, with the content in one inset panel: workspace row, fixed block (Inbox, Tasks, Routines), Channels, the Bots tree (chief first, each bot expands to its five most recent chats, "New chat", "All chats"), and More (Studio, Dashboard, Computer).

## Non-goals

No bot reordering (RFC-085). No chat surface change (RFC-086). No new attention store: use RFC-071's projection.

## Source anchors and planned changes

- `apps/web/src/features/chat/sidebar.tsx`
- `apps/web/src/routes/_auth/route.tsx` (layout: ground, inset panel, 48px header)
- Settings and sign out move into the workspace menu.

## Contract and implementation steps

1. Build the layout: 240px sidebar, inset content panel (8px inset, 1px border, 12px radius), 48px header.
2. Build the groups and rows as DESIGN.md says: 28px rows, hover and selected states with `aria-current`, status at the end of the row with a text name for screen readers.
3. Bot rows expand to recent chats (opacity and `y` with `motion`, siblings move with `layout`). Group open state is kept per user in local storage.
4. Collapse to a 48px rail that keeps attention dots; below 768px the sidebar is a sheet. Use TanStack `<Link>` for every in-app row.

## Acceptance criteria

- [ ] With 20 bots and 5 chats each (synthetic data), a keyboard user reaches any chat, and the selected row is announced.
- [ ] Attention counts agree with Inbox after reload.
- [ ] Layout holds at 390, 768, 1024 and 1440px in light and dark.

## Verification

`bun test apps/web/src/in-app-links.test.ts` and focused tests for pure grouping/selection logic. Browser screenshots need approval.

## Definition of done

- [ ] Acceptance criteria have evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.

## Completion record (2026-11-01)

**Status: Done.** (Verified 2026-11-01, see the RFC-088 record.) Built and checked on desktop in dark mode; the phone sheet and light mode of the new shell were not checked in a browser.

- **Changed:** `apps/web/src/components/app-shell.tsx` (new), `apps/web/src/components/app-sidebar.tsx` (new), `apps/web/src/components/header.tsx` (old `AppRail` removed), `apps/web/src/components/rail-row.ts`, `apps/web/src/components/user-menu.tsx`, `apps/web/src/components/mode-toggle.tsx`, `apps/web/src/components/app-links.ts` ("Notifications" is now "Inbox"), `apps/web/src/features/studio/{studio-tabs.ts,studio-page.tsx,attention.tsx}` (same rename), `apps/web/src/features/chat/sidebar.tsx` (now `SidebarTree`, reads its own data and route), `apps/web/src/features/chat/chat-page.tsx` and `apps/web/src/features/discussions/discussions-page.tsx` (their sidebar column and phone menu button removed), `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/_auth/route.tsx`.
- **Shell:** the signed-in layout wraps in-app pages in `AppShell`: one sidebar on `--sidebar`, the page in an inset panel (8px, 12px radius, 1px border). Below 768px: a 48px top bar opens the sidebar in a sheet, closed on navigation. The command palette is mounted once in the shell.
- **Sidebar:** top row (home, search, new chat), Inbox/Tasks/Routines, filter, Rooms, Bots (views, `+` menu, Favorites, chief first, workspaces, user order), More, footer (Theme, Collapse, account). Collapsed: 48px rail with icons and bot avatars with attention dots.
- **Checks:** `tsc --noEmit` (web): no errors in changed files (3 errors remain in `emoji-picker.tsx`, `install-onboarding.tsx` and `packages/ui/.../skeleton.tsx`; they come from earlier work). `oxlint` on changed files: clean. `bun test src/in-app-links.test.ts`: pass. Vite transformed every changed module (HTTP 200).
- **Browser (Helium, 1512px, dark):** chat page, rooms page, collapse and expand, keyboard reorder. Fixed during the check: the Bots heading label was cut off and "By bot" wrapped at the 192px width.
- **Not checked:** the 390px phone sheet, light mode of the new shell, a 20-bot fixture.

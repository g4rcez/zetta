# Redesign: chat-first workspace

Status: confirmed intent. Authority: the user pinned the direction in the interview (Linear as the UX reference, emerald, Geist, one sidebar, 7:1 contrast); no Impeccable concept roll was run, so there is no seed reference. [DESIGN.md](../../DESIGN.md) is the target system. The work is RFC-083 to RFC-088 in [TASKS.md](../../TASKS.md#21-redesign). This redesign replaces the visual reference in [zetta-v1](zetta-v1.md); the product scope there is unchanged.

## Intent

- **Outcome:** replace the "Quiet Dispatcher" look with a Linear-style, chat-first identity. It works like Slack, with one change: each bot has many chats, so the user keeps one intention per chat.
- **Shell:** one sidebar (collapses to a rail): fixed block (Inbox, Tasks, Routines), Rooms (the product's word for channels), Bots tree (chief first, then the user's order, each bot expands to its recent chats), More (Agenda, Studio, Plugins, Computer, Dashboard, Teams, Artifacts). A context panel opens on the right on demand.
- **Reorder:** drag with `motion` `Reorder`, keyboard alternative, order saved per user on the server (`user_preference.bot_order`).
- **Visual system:** cool neutrals, emerald primary (`#015A45` light, `#47C7A1` dark; brand `#29A383` / `#27B08B`), amber only for attention, Geist, 14px base text, even values on a 4px grid.
- **Accessibility:** WCAG 2.2 AA, with 7:1 or more for every text color pair.
- **Themes:** semantic tokens only; a new scheme is new values for the same tokens.
- **References:** Linear for the UX and visual quality; agentes.chat for the mental model only (channels and agents in one sidebar). Copy neither one's branding, text or exact layouts.
- **Out of scope:** chat data-model changes and color schemes other than light and dark.

## Phases

Each phase ships alone and leaves the app working.

| Phase                          | RFC                                                                         | Gate                                        |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------- |
| Tokens and the contrast guard  | [RFC-083](../../tasks/083-apply-redesign-tokens-and-contrast-guard.md)      | none                                        |
| Shell and sidebar              | [RFC-084](../../tasks/084-rebuild-sidebar-shell-for-chat-first-redesign.md) | coordinate with open edits to `sidebar.tsx` |
| Per-user bot order             | [RFC-085](../../tasks/085-persist-per-user-bot-order.md)                    | schema change needs approval                |
| Chat surface and context panel | [RFC-086](../../tasks/086-restyle-chat-surface-and-context-panel.md)        | none                                        |
| Remaining pages                | [RFC-087](../../tasks/087-restyle-remaining-pages-to-tokens.md)             | none                                        |
| Accessibility and finish       | [RFC-088](../../tasks/088-verify-redesign-accessibility-and-finish.md)      | approved browser runs                       |

## Risks

- `@g4rcez/components` may hard-code values that do not follow the `--var-*` bridge. RFC-083 lists them; RFC-087 fixes them.
- The contrast guard must compute tints the same way the CSS mixes them (OKLCH), not in sRGB.
- Light-mode emerald (`#015A45`) is much darker than the brand `#29A383`. This is the cost of 7:1.
- `.impeccable/design.json` still describes the old design until RFC-088 regenerates it.

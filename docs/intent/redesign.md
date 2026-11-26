# Redesign: chat-first workspace

Status: confirmed intent. Authority: the user pinned the direction in the interview (Linear as the UX reference, emerald, Geist, one sidebar, 7:1 contrast); no Impeccable concept roll was run, so there is no seed reference. [DESIGN.md](../../DESIGN.md) is the target system. This redesign replaces the visual reference in [zetta-v1](zetta-v1.md); the product scope there is unchanged.

## Intent

- **Outcome:** replace the "Quiet Dispatcher" look with a Linear-style, chat-first identity. It works like Slack, with one change: each bot has many chats, so the user keeps one intention per chat.
- **Shell:** one sidebar (collapses to a rail): fixed block (Inbox, Tasks, Routines), Rooms (the product's word for channels), Bots tree (chief first, then the user's order, each bot expands to its recent chats), More (Agenda, Studio, Plugins, Computer, Dashboard, Teams, Artifacts). A context panel opens on the right on demand.
- **Reorder:** drag with `motion` `Reorder`, keyboard alternative, order saved per user on the server (`user_preference.bot_order`).
- **Visual system:** cool neutrals, emerald primary (`#015A45` light, `#47C7A1` dark; brand `#29A383` / `#27B08B`), amber only for attention, Geist, 14px base text, even values on a 4px grid.
- **Accessibility:** WCAG 2.2 AA, with 7:1 or more for every text color pair.
- **Themes:** semantic tokens only; a new scheme is new values for the same tokens.
- **References:** Linear for the UX and visual quality; agentes.chat for the mental model only (channels and agents in one sidebar). Copy neither one's branding, text or exact layouts.
- **Out of scope:** chat data-model changes and color schemes other than light and dark.

---
name: Zetta
description: A chat-first workspace for bots, in the Linear manner: cool neutrals, one emerald signal, amber only when a person is needed, 7:1 text contrast in every theme.
colors:
  sidebar: "#F3F3F5"
  background: "#FBFBFC"
  card: "#FFFFFF"
  popover: "#FFFFFF"
  secondary: "#F0F0F3"
  muted: "#F0F0F3"
  accent: "#EDEDF0"
  foreground: "#18181B"
  muted-foreground: "#4A4A52"
  border: "#E2E2E6"
  input: "#8A8A93"
  primary: "#015A45"
  primary-foreground: "#FFFFFF"
  ring: "#015A45"
  attention: "#F0A63A"
  attention-foreground: "#2B1A00"
  warn: "#6A4100"
  success: "#1A4F18"
  info: "#16457E"
  destructive: "#8A1818"
  status-foreground: "#FFFFFF"
  sidebar-dark: "#09090B"
  background-dark: "#0F0F11"
  card-dark: "#141417"
  popover-dark: "#1A1A1E"
  secondary-dark: "#1C1C20"
  muted-dark: "#1C1C20"
  accent-dark: "#26262B"
  foreground-dark: "#EDEDF0"
  muted-foreground-dark: "#B4B4BC"
  border-dark: "#26262B"
  input-dark: "#6E6E78"
  primary-dark: "#47C7A1"
  primary-foreground-dark: "#09090B"
  ring-dark: "#47C7A1"
  attention-dark: "#F5B455"
  attention-foreground-dark: "#1F1300"
  warn-dark: "#F5B455"
  success-dark: "#8FD98A"
  info-dark: "#8DB8F2"
  destructive-dark: "#FF9C94"
  status-foreground-dark: "#09090B"
typography:
  headline:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "24px"
    lineHeight: "32px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "16px"
    lineHeight: "24px"
    fontWeight: 500
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "14px"
    lineHeight: "20px"
    fontWeight: 400
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "12px"
    lineHeight: "16px"
    fontWeight: 500
  code:
    fontFamily: "Geist Mono Variable, monospace"
    fontSize: "12px"
    lineHeight: "20px"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 8px"
  icon-button:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    size: "28px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  sidebar-row:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 8px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  composer:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "12px"
  badge:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    height: "20px"
    padding: "0 8px"
  attention-badge:
    backgroundColor: "{colors.attention}"
    textColor: "{colors.attention-foreground}"
    rounded: "{rounded.sm}"
    height: "20px"
    padding: "0 6px"
---

# Design System: Zetta

## Overview

**Creative North Star: "Talk to the right bot, in the right chat."**

Zetta is a chat workspace for bots. It works like Slack, with one change: each bot has many chats. A user starts a new chat for each intention, so the bot keeps a clean context and the user can find the work again. The chief is the first bot; the other bots follow in the order that the user sets.

The visual reference is Linear: a quiet gray ground, one content panel, dense rows, fast keyboard paths, and no decoration. The interface stays still while bots work. Two colors speak: emerald marks what the user can act on or has selected, and amber marks the places where a person is needed.

**Key Characteristics:**

- Cool, low-chroma neutrals in light and dark themes. One emerald signal. Amber only for attention.
- WCAG 2.2 AA, with AAA color contrast: every text and background pair is 7:1 or more (PRODUCT.md). Non-text indicators (input borders, focus rings, icons that carry meaning) are 3:1 or more. Focus rings are always visible.
- All sizes and spaces are even pixel values on a 4px grid. Base text is 14px.
- Flat at rest. Depth comes from surface tone and 1px borders; only floating layers have shadows.
- Every color comes from a semantic token. A new color scheme is a new set of values for the same tokens.

## Theming and tokens

The token names are fixed. Do not add tokens; change values.

- **Source of values:** `packages/ui/src/styles/globals.css` holds the app tokens for `:root` (light) and `.dark`. `apps/web/src/index.css` maps them to the `--var-*` tokens of `@g4rcez/components` and sets the status values (`--var-color-success`, `-info`, `-warn`, `-danger`, each with `-foreground`).
- **Color themes:** light is `:root`, dark is `.dark`. Six more live in `apps/web/src/themes.css`, one `:root[data-theme="<name>"]` block each: Darcula, Darcula Light (light base), Catppuccin, Tokyo Night, One Dark and Nord (dark base). Their hues come from the original schemes; lightness moves until the block passes the contrast table below, and `tokens.test.ts` runs every block. A new theme is one more block, plus its entry in `features/preferences/theme.ts` and `THEMES` in `packages/db`.
- **Choice and main color:** the theme and the main color are account preferences (`theme`, `primaryColor`). A chosen main color replaces `--primary` and `--primary-foreground` for any theme, and may fall under 7:1: Preferences warns when it is under 5:1 on the theme's grounds. The shipped themes keep 7:1.
- **Components** use Tailwind token classes (`bg-background`, `text-muted-foreground`, `border-border`, `bg-attention`, `text-warn`) or `var(--token)`. Never raw hex, never Tailwind palette colors (`emerald-600`, `zinc-800`), never `--var-*` outside the bridge in `index.css`.
- **Mirrors:** `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground`, `--sidebar-foreground` and `--sidebar-accent-foreground` equal `--foreground`. `--sidebar-primary` and `--sidebar-ring` equal `--primary`. `--sidebar-accent` equals `--accent`. `--sidebar-border` equals `--border`. `--ring` equals `--primary`.
- **Charts:** `--chart-1` to `--chart-5` are, in order, the values of primary, info, warn, destructive and muted-foreground for the same theme. Every series passes 3:1 against the chart ground.

## Colors

Values are sRGB hex so that contrast is directly measurable.

### Surfaces

| Token                     | Light     | Dark      | Use                                                            |
| ------------------------- | --------- | --------- | -------------------------------------------------------------- |
| `--sidebar`               | `#F3F3F5` | `#09090B` | App ground: the sidebar and the frame around the content panel |
| `--background`            | `#FBFBFC` | `#0F0F11` | The content panel (chat, lists, pages)                         |
| `--card`                  | `#FFFFFF` | `#141417` | Cards, composer, inputs                                        |
| `--popover`               | `#FFFFFF` | `#1A1A1E` | Menus, popovers, command palette, dialogs                      |
| `--muted` / `--secondary` | `#F0F0F3` | `#1C1C20` | Quiet fills: code, badges, secondary buttons                   |
| `--accent`                | `#EDEDF0` | `#26262B` | Hover and the selected sidebar row                             |
| `--border`                | `#E2E2E6` | `#26262B` | Hairlines and panel edges (decorative)                         |
| `--input`                 | `#8A8A93` | `#6E6E78` | Borders of inputs, checkboxes and other controls (3:1 or more) |

### Text

| Token                | Light     | Dark      | Use                                                    |
| -------------------- | --------- | --------- | ------------------------------------------------------ |
| `--foreground`       | `#18181B` | `#EDEDF0` | Main text and icons                                    |
| `--muted-foreground` | `#4A4A52` | `#B4B4BC` | Secondary text, timestamps, placeholders, group labels |

There is no third, lighter text tone. A lighter gray cannot meet 7:1, so hierarchy comes from size, weight and position.

### Primary: emerald

| Token                  | Light     | Dark      |
| ---------------------- | --------- | --------- |
| `--primary`            | `#015A45` | `#47C7A1` |
| `--primary-foreground` | `#FFFFFF` | `#09090B` |

Brand emerald is `#29A383` (light) and `#27B08B` (dark). The token values are the same hue, darker in light mode and lighter in dark mode, until they pass 7:1. Use: the primary button, links, the focus ring, checked controls, the selected icon in the sidebar, the send button, and text selection (35% mix).

### Attention and status

| Token                                | Light     | Dark      | Use                                                  |
| ------------------------------------ | --------- | --------- | ---------------------------------------------------- |
| `--attention`                        | `#F0A63A` | `#F5B455` | Fill of the "needs you" badge and dot                |
| `--attention-foreground`             | `#2B1A00` | `#1F1300` | Text on `--attention`                                |
| `warn` (`--var-color-warn`)          | `#6A4100` | `#F5B455` | Attention as text, on a 10% tint                     |
| `success`                            | `#1A4F18` | `#8FD98A` | Completed                                            |
| `info`                               | `#16457E` | `#8DB8F2` | Informational                                        |
| `destructive` (`--var-color-danger`) | `#8A1818` | `#FF9C94` | Failed, blocked, destructive actions, invalid fields |
| status `-foreground`                 | `#FFFFFF` | `#09090B` | Text on a solid status fill                          |

Success is a yellow-green (hue about 140), so it does not read as emerald. Status color never works alone: it comes with an icon or a word.

### Contrast table (the acceptance test)

A theme passes when all these pairs pass. The current values pass. The lowest text pair is 7.05:1 (light primary on `--accent`).

- 7:1 or more: `--foreground`, `--muted-foreground` and `--primary` on `--sidebar`, `--background`, `--card`, `--popover`, `--muted` and `--accent`.
- 7:1 or more: `--primary-foreground` on `--primary`; `--attention-foreground` on `--attention`; each status `-foreground` on its status fill.
- 7:1 or more: warn, success, info and destructive as text on `--background`, `--card`, `--sidebar` and on their own 10% tint.
- 3:1 or more: `--input` and `--ring` on `--background`, `--card` and `--sidebar`.

### Named Rules

**The One Signal Rule.** Emerald marks the thing to act on or the selected thing. It never decorates, and it never means "success".

**The Attention Rule.** Amber means "a person is needed" and nothing else. It is the loudest thing on screen.

**The Tint Not Fill Rule.** Failed and blocked states are a 10% tint with colored text and an icon, never a solid fill, so a failure does not out-shout a request for the user.

## Typography

**Family:** Geist Variable for all text. Geist Mono Variable only for code, keyboard shortcuts and identifiers. No third family, no serif.

| Role        | Size / line    | Weight | Use                                                |
| ----------- | -------------- | ------ | -------------------------------------------------- |
| Headline    | 24 / 32px      | 600    | Page title (`h1`), one per page                    |
| Title       | 16 / 24px      | 500    | Section title (`h2`), chat title, dialog title     |
| Body        | 14 / 20px      | 400    | Default UI text and chat messages (the base token) |
| Body strong | 14 / 20px      | 500    | Sidebar rows, author names, buttons                |
| Label       | 12 / 16px      | 500    | Group labels, badges, timestamps, helper text      |
| Code        | 12 / 20px mono | 400    | Code blocks, inline code, keycaps                  |

- The base text size is 14px: `body` in `globals.css` and `--var-fontsize` in `index.css` are both 14px (0.875rem). Chat text is also 14px.
- Group labels in the sidebar are sentence case, sans, 12px, `--muted-foreground`. No uppercase mono labels.
- Use `tabular-nums` for counts, times and sizes. Use `text-balance` on headings and `text-pretty` on long text.
- No text below 12px.

## Layout

### Shell

```
┌ sidebar 224px ───────┬ content panel (--background) ──────────────────┬ context panel 360px ┐
│ ◆ Zetta       ⌕  ✎   │ header 48px: Bot › Chat title ⌄        ⋯  ◫    │ (on demand)         │
│ Inbox            3   │                                                │ thread / bot /      │
│ Tasks                │ messages (full panel width)                    │ files               │
│ Routines             │                                                │                     │
│ [⌕ Filter…        ]  │                                                │                     │
│ › Rooms          +   │                                                │                     │
│ ⌄ Bots  By bot Recent +                                               │                     │
│  › ◉ Chief      1d   │                                                │                     │
│  ⌄ ◉ Writer  + ⋯     │ ┌ composer (--card, 12px radius) ───────────┐ │                     │
│      + New chat      │ │ Message Writer…                        ⏎  │ │                     │
│      Weekly brief 2h │ └───────────────────────────────────────────┘ │                     │
│ › More               │                                                │                     │
│ Theme · Collapse     │                                                │                     │
│ (A) Account      ⇕   │                                                │                     │
└──────────────────────┴────────────────────────────────────────────────┴─────────────────────┘
```

- **Ground and panel.** The sidebar and the frame use `--sidebar`. The content sits in one panel on `--background`, inset by 8px, with a 1px `--border` edge and a 12px radius. On screens below 768px the panel fills the screen with no inset.
- **One sidebar.** 224px by default; the user drags its edge (or uses the arrow keys on it) between 192 and 360px. It collapses to a 56px rail: the top row, the fixed block, Rooms, the bot avatars and the More icons, with the attention dots kept. Width and collapsed state are saved per user (`user_preference`). Below 768px it is a sheet that opens from a 48px top bar.
- **Where it lives.** `AppShell` (`apps/web/src/components/app-shell.tsx`) wraps every in-app page in the signed-in layout; pages never draw their own sidebar or list column.
- **Context panel.** 360px, on the right, opened on demand for thread replies, bot details and the chat's files. It is not a permanent column. Below 1024px it is a sheet.
- **Spacing.** A 4px grid with even values only: 4, 8, 12, 16, 24, 32, 48. 16px is the standard padding of a card and of the panel; 8px separates related controls; 4px separates a row's icon from its text.
- **Sizes.** Sidebar rows 28px. Buttons and inputs 32px. Icon buttons 28px (the 24px AA target minimum is met). Header 48px. The message column fills the panel.
- Full-height layouts use `h-dvh`, not `h-screen`. Fixed elements respect `safe-area-inset`.

### Sidebar structure

From top to bottom:

1. **Top row.** The Zetta mark (home), then search (`⌘K`, the command palette) and new chat with the open bot (or the chief).
2. **Fixed block.** Inbox (the attention model: needs input, blocked, new results; amber count), Tasks (the kanban), Routines, Memory (what the bots know: the explorer at `/memory` and one page per item at `/memory/<slug>`; the old `/wiki` addresses redirect).
3. **Filter.** One field that filters rooms, bots and chats.
4. **Rooms.** Group discussions where several bots and people share one conversation ("rooms" is the product's word for them). Rows start with `#`; the Chief's help and permission rooms sit apart under "Bot issues".
5. **Bots.** The heading has a clock toggle that lists every chat by time instead of by bot, and a `+` menu (New chat, New bot, New folder, New room). Favorites come first, then the chief, pinned first and not movable, then the other bots in the user's order, grouped by folder when the user has folders. Each bot row expands to "New chat" and its five most recent chats, then "Show N more". Hover or focus shows "New chat" (`+`) and a menu (`⋯`: New chat, Move up, Move down, Settings) on the row.
6. **More.** Agenda, Studio, Plugins, Computer, Dashboard, Teams, Artifacts. Closed by default; open while one of its pages is shown.
7. **Footer.** Theme, Collapse, and the account menu (name, email, sign out).

A group heading toggles its group; the open or closed state is kept in the browser.

### Bot order

- The user drags a bot row to reorder it. Use `Reorder.Group` and `Reorder.Item` from `motion` (already a dependency of `apps/web`), with `layout` animation so the other rows move aside.
- Keyboard alternative (required, WCAG 2.5.7): "Move up" and "Move down" in the row menu, and `Alt+↑` / `Alt+↓` on a focused row. A polite live region says the new position ("Writer moved to position 3 of 7").
- The order is saved per user on the server (`user_preference.bot_order`, a list of bot ids sent through `PATCH /api/preferences`), so it is the same on every device. A bot missing from the list sorts after the placed ones, in the server's order. The old per-browser order is moved to the account once.

## Motion

Motion uses `motion` (`motion/react`). It confirms a cause; it never decorates.

- **Durations:** 150ms for hover and press feedback (CSS, the Tailwind default), 160ms for expand and collapse, 200ms for panels and sheets. Exits are faster than entries. Nothing that answers an input takes more than 200ms.
- **Reorder:** a spring (stiffness about 600, damping about 40) on `layout`. The dragged row lifts with a Float shadow while it is dragged.
- **Expand / collapse:** the chats of a bot enter with opacity and a 4px `y` shift; the rows below move with `layout`. Do not animate `height`.
- **Only `transform` and `opacity`.** Never animate width, height, top, left, margin or padding.
- **Reduced motion:** with `prefers-reduced-motion` (`useReducedMotion`), layout changes are instant and only opacity fades remain.

## Elevation & Depth

Flat at rest. Surfaces separate by tone (`--sidebar` → `--background` → `--card` → `--popover`) and by 1px `--border` lines.

- **Float:** menus, popovers, command palette and the row that is being dragged. A small shadow plus a 1px `--border`.
- **Sheet:** sheets and dialogs. A larger shadow over a 60% black overlay.

**The Flat-At-Rest Rule.** Cards, lists, rows and panels have no shadow.

## Shapes

`--radius` is 8px. The scale is sm 4px, md 6px, lg 8px, xl 12px, 2xl 16px.

- md (6px): buttons, inputs, sidebar rows, menu items.
- lg (8px): cards, popovers, menus, code blocks.
- xl (12px): the content panel, the composer, dialogs.
- sm (4px): badges, inline code, keycaps.
- Avatars of people are circles. Avatars of bots are the bot's own art (a preset shape or character, or an image), so the two read differently.
- **Avatar art is exempt** (user decision, 2026-11-01): bot avatar art, presets and uploaded images alike, is identity content. Its gradients, small shadow and own colors sit outside the token, gradient and Flat-At-Rest rules; everything drawn around an avatar still follows them.
- **The Zetta mark** is the chief's robot art on purpose: the chief is named "Zetta" by default (user decision, 2026-11-01), so home and the chief read as one. The user can rename the chief.
- **Logo tile:** at avatar and mark sizes (≤ 36px) the robot keeps the logo's own contrast on either ground (`<Logo tile />`). On the light theme its light face would vanish against the light sidebar, so it sits at 80% on a tile of the logo's ink (`--logo-ink`, `#2b3440`): rounded square for the mark, circle or rounded square for the chief's avatar like other bot art. On the dark theme the face already stands out (16.7:1 on `#09090B`), so the tile is clear and the robot fills it. Large illustrations (sign-in, onboarding) keep the bare robot.

## Components

### Buttons

- **Primary:** `--primary` fill, `--primary-foreground` text, 32px, 12px side padding, md radius. One per view.
- **Secondary:** `--card` fill, 1px `--input` border, `--foreground` text.
- **Ghost:** no fill; `--accent` fill on hover.
- **Destructive:** destructive 10% tint with destructive text; a confirmation dialog comes before any action that cannot be undone.
- **Focus:** 2px `--ring` outline with 2px offset. **Press:** no movement. **Disabled:** 50% opacity, `cursor: not-allowed`, and the `disabled` attribute.

### Inputs

- 32px, md radius, `--card` fill, 1px `--input` border. Focus: `--ring` border and a 1px `--ring` ring. Error: destructive border, an icon, and a message below the field linked with `aria-describedby`.
- Placeholder text uses `--muted-foreground` and is never the only label.

### Sidebar rows

- 28px, md radius, 8px side padding, 16px icon or avatar, 14px medium text.
- Hover: `--accent` fill. Selected: `--accent` fill, `--foreground` text, icon in `--primary`, and `aria-current="page"`. No side stripes.
- Status at the end of the row: an amber count for unread "needs you" items (a quiet `--muted` count once seen but still open), an amber dot on rooms that need the user, a small spinner for "working", a destructive icon for "blocked". A bot with unread items has 600 weight. Each state also has a text name for screen readers.
- The caret that opens a bot's chats is a 24px target (WCAG 2.2 target size). Nested chat rows indent 56px so their text lines up with the bot name. They show no time, so the title (the chat's one intention) gets the rest of the row; the bot row carries the latest time. Trade-off: at 192px a nested title has about 116px.
- One row is the open page (`aria-current="page"` and the fill): the open chat, or the bot row only on its empty draft. A bot whose chat is open is `aria-current="true"` without fill.
- Keyboard: ↑/↓ walk bot and chat rows, → opens a bot's chats, ← closes them, `Alt+↑`/`Alt+↓` move a bot.

### Chat

- **Header:** "Bot › Chat title ⌄ ⋯". The bot name is 14px muted and links to its settings; the chat title is in the Title style. The title opens the chat switcher, a combobox: a search field, "Chats" / "Archived" views, the matching chats (↑/↓ and Enter; the open one checked), and "New chat". An archived chat comes back when opened. `⋯` renames, archives or deletes the open chat (with Undo). The tooltip never shows the harness or model.
- **Context panel:** 360px on the right; an open thread takes it, otherwise "Details" (the bot, its status and description, Bot settings, and the files in this chat). It arrives with a 200ms fade and 8px shift.
- **Messages:** flat rows, not bubbles. A 32px avatar, then name and time on one line (time in Label style), then the body. Consecutive messages from one author within five minutes group under one header.
- **Bot work:** a "Working…" block that the user can expand to a list of steps with done, running and failed icons. When the run ends it collapses to one summary line.
- **Needs you:** shown today by the amber counts in the sidebar and Inbox. Planned: an inline card in the chat with an attention 10% tint, the question, and its actions.
- **Actions of a run:** the action notes at the end of a reply ("Used …", "Published …") fold into one "N actions" line that expands to the list.
- **Composer:** `--card`, xl radius, 1px `--border`, as wide as the messages; a formatting row (bold, italic, code, link, preview) above a text area that grows to 40% of the panel height; a toolbar with attach and mention on the left and the send button (`--primary`, 28px circle) on the right. `Enter` sends, `Shift+Enter` adds a new line.
- **Code:** `.chat-code` with lg radius on an 8% `--foreground` mix, mono 12px, and a 28px copy button that is always visible at 85% opacity and full on hover and on focus. Inline code uses sm radius on a 6% `--foreground` mix with a 1px `--border`.

### Badges

- 20px, sm radius, 12px medium text, 8px side padding (6px for the attention count in the sidebar). Neutral: `--muted` with `--foreground`. Attention: `--attention` with `--attention-foreground`. Status: 10% tint with status text and an icon.

### Icons

- An icon that carries meaning and has no visible title next to it (for example "Pinned", "Chief", "Paused") shows its name in a `Popover`: use `IconHint` from `@zetta/ui/components/icon-hint`. It opens on hover, on keyboard focus and on tap; Escape closes it. The `aria-label` stays on the trigger, so the screen reader name is the same.
- The trigger is a `<span tabIndex={0}>` that Base UI exposes as `role="button"` with `aria-expanded`, because ARIA does not allow `aria-expanded` on `img`. It does no action. The hit area is at least 24x24px (WCAG 2.5.8). It keeps the 2px `--ring` focus outline.
- **Exception:** a decorative icon next to visible text (`aria-hidden="true"`) needs no Popover.
- **Never nest it** in a link or a button: a focusable trigger inside one is invalid (WCAG 4.1.2). Keep the `aria-label` there and let the row's own label and tooltip carry the meaning.
- **Open point:** an icon-only button that acts on click keeps `Tooltip` + `aria-label` until the owner decides.

### Empty, loading and error states

- Empty: one sentence that says what goes here and one action. No illustration.
- Loading: skeleton rows in `--muted` for content; a spinner only inside buttons.
- Error: next to where the action happened, with the cause and a retry.

## Do's and Don'ts

### Do:

- **Do** use only the semantic tokens; change token values, never add tokens.
- **Do** check every new theme or color change against the contrast table (7:1 text, 3:1 non-text).
- **Do** use even pixel values on the 4px grid, with 14px base text.
- **Do** keep emerald for actions and selection, and amber for "a person is needed".
- **Do** give every drag a keyboard alternative and every icon-only button an `aria-label`.
- **Do** use TanStack Router `<Link>` for in-app navigation (see CLAUDE.md).
- **Do** use the shared `@zetta/ui` and `@g4rcez/components` primitives before you build new ones.

### Don't:

- **Don't** use raw hex, Tailwind palette colors or `--var-*` tokens in components.
- **Don't** add a lighter third text gray, a second accent hue, or a gradient.
- **Don't** put shadows on cards, lists or panels, or side stripes on rows.
- **Don't** use uppercase mono labels, text below 12px, or odd pixel values.
- **Don't** copy Linear's or any competitor's logo, text, illustrations or exact layouts.
- **Don't** show technical words (harness, MCP, hook) in default views.
- **Don't** let color alone carry a state; add an icon or a word.

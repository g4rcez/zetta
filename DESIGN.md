---
name: Zetta
description: A calm, indigo-tinted control surface for managing autonomous bots.
colors:
  primary: "oklch(0.55 0.2 275)"
  primary-dark: "oklch(0.68 0.17 275)"
  on-primary: "oklch(0.99 0 0)"
  accent-wash: "oklch(0.94 0.02 275)"
  accent-ink: "oklch(0.3 0.08 275)"
  ring: "oklch(0.6 0.15 275)"
  destructive: "oklch(0.58 0.22 27)"
  background: "oklch(0.985 0.003 265)"
  foreground: "oklch(0.2 0.01 265)"
  card: "oklch(1 0 0)"
  secondary: "oklch(0.955 0.006 265)"
  muted-foreground: "oklch(0.5 0.015 265)"
  border: "oklch(0.91 0.008 265)"
  input: "oklch(0.9 0.008 265)"
  sidebar: "oklch(0.97 0.005 265)"
  background-dark: "oklch(0.15 0.006 265)"
  card-dark: "oklch(0.2 0.008 265)"
  sidebar-dark: "oklch(0.175 0.007 265)"
  muted-foreground-dark: "oklch(0.7 0.012 265)"
typography:
  headline:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  sm: "8px"
  md: "16px"
  card: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 14px"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 14px"
  button-destructive:
    textColor: "{colors.destructive}"
    rounded: "{rounded.md}"
    height: "36px"
  input:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    height: "20px"
    padding: "2px 8px"
---

# Design System: Zetta

## Overview

**Creative North Star: "The Quiet Dispatcher"**

Work happens on the server; the interface stays still until something needs the user. Zetta reads as a calm control room: indigo-tinted neutrals, one violet accent, hairline structure, and no decoration competing with bot output or attention states. When a bot is working, nothing should shout; when a person is needed, that is the loudest thing on screen.

The mood is friendly and soft rather than clinical: generous 8px corners, compact but not cramped 36px controls, and Inter throughout. Enterprise teams mixing technical and non-technical people share one surface, so default flows read plainly and advanced controls sit one step deeper rather than in a different visual language.

**Key Characteristics:**

- Cool indigo-tinted neutrals (hue 265) with a single violet accent (hue 275).
- Flat, tonal layering; depth from 1px rings and surface tint, not shadows.
- Light and dark themes with equal standing (class-based `.dark`).
- Dense, scannable app chrome (sidebar, lists, chat) at 14px body.
- WCAG 2.2 AA is a requirement (PRODUCT.md); focus rings are always visible.

## Colors

A near-monochrome indigo-grey field with one violet voice. Values are OKLCH, the project's source of truth in `packages/ui/src/styles/globals.css`.

### Primary

- **Signal Violet** (`oklch(0.55 0.2 275)`): primary actions, selected state, links, checkbox/radio accent, text selection tint. In dark mode it lifts to **Signal Violet, Lit** (`oklch(0.68 0.17 275)`) with near-black foreground text.
- **Violet Wash** (`oklch(0.94 0.02 275)`) with **Violet Ink** (`oklch(0.3 0.08 275)`): accent surfaces such as hovered menu items and sidebar selection.

### Secondary

- **Alarm Red** (`oklch(0.58 0.22 27)`): destructive actions and invalid fields, used as a 10% tint background with red text rather than a solid fill.

### Neutral

- **Cool Paper** (`oklch(0.985 0.003 265)`): page background. **Card White** (`oklch(1 0 0)`) for cards and popovers.
- **Ink** (`oklch(0.2 0.01 265)`): foreground text. **Dim Ink** (`oklch(0.5 0.015 265)`): secondary text and placeholders.
- **Hairline** (`oklch(0.91 0.008 265)`): borders; **Field Line** (`oklch(0.9 0.008 265)`) for inputs; **Mist** (`oklch(0.955 0.006 265)`) for secondary and muted fills; **Rail** (`oklch(0.97 0.005 265)`) for the sidebar.
- Dark: **Night Field** (`oklch(0.15 0.006 265)`), **Night Card** (`oklch(0.2 0.008 265)`), **Night Rail** (`oklch(0.175 0.007 265)`); borders are white at 8% and inputs white at 12%.

### Named Rules

**The One Voice Rule.** Signal Violet marks the thing you can act on or that is selected. It never decorates. If two violet elements compete on one screen region, one of them is wrong.

**The Tint Not Fill Rule.** Danger and attention states use a low-opacity tint with colored text, never a saturated fill, so a failed run does not out-shout a request for the user's input.

## Typography

**Display / Body / Label Font:** Inter Variable (with `sans-serif` fallback). One family; hierarchy comes from weight and size.
**Mono:** system monospace for chat code (`.chat-code`, 13px, 1.5 line height).

**Character:** Neutral, legible, a little tight at heading sizes. It stays out of the way of bot-written content.

### Hierarchy

- **Headline** (600, 1.5rem, tracking -0.025em): page titles (`h1`).
- **Title** (600, 1rem, tracking -0.025em): section headings (`h2`), card titles at 14px/500.
- **Body** (400, 0.875rem): default UI and chat text.
- **Label** (500, 0.8125rem to 0.75rem): buttons, badges, field labels, metadata.

### Named Rules

**The One Family Rule.** Do not add a second typeface. Differentiate with weight and size.

## Layout

App shell: a left sidebar (tinted Rail) plus a main region, behind an authenticated route group (chat, studio, agenda, dashboard, discussions, computer). Content is dense and list-driven; spacing follows Tailwind's 4px rhythm with 16px as the standard card padding (12px for small cards) and 8px between related controls. Chat, kanban and timeline views fill the available width and scroll internally; custom scrollbars are 10px thumbs at 18% foreground. Layouts must hold from phone widths up, with sheets replacing side panels on narrow screens.

## Elevation & Depth

Flat and tonal. Surfaces separate by a 1px ring (`ring-1 ring-foreground/10`) or border and by a step in surface tone (background, card, muted, rail). Shadows exist only on things that float over content.

### Shadow Vocabulary

- **Float** (`shadow-md` + 10% ring): dropdown menus and popovers.
- **Sheet** (`shadow-lg`): side and bottom sheets.
- **Field hint** (`shadow-xs`): input groups only.

### Named Rules

**The Flat-At-Rest Rule.** Cards, lists and panels carry no shadow. If something needs lifting, it should be a floating layer.

## Shapes

Soft but not round. Base radius is 0.5rem (8px) with a derived scale: sm 4px, md 6px, lg 8px, xl 12px, 2xl 16px. Buttons and inputs use md, cards lg, small buttons lg, icon-lg buttons are full circles, scrollbar thumbs are pills. Badges in the shared package are square-cornered; treat that as an inconsistency to resolve, not a pattern to extend.

## Components

### Buttons

- **Shape:** gently curved (6px); xs/sm sizes at 8px.
- **Primary:** Signal Violet fill, near-white text, 36px tall, 14px horizontal padding; hover drops to 80% opacity.
- **Outline / Secondary / Ghost:** card or mist fill with hairline border; ghost shows a mist fill only on hover.
- **Destructive:** red tint with red text, deepening on hover.
- **Focus / Press:** 1px violet ring at 50% plus a violet border; 1px downward nudge on press; disabled at 50% opacity.

### Inputs / Fields

- **Style:** 40px tall, 6px radius, hairline-input border over a 40% mist fill (30% input tone in dark).
- **Focus:** violet border and 1px 50% ring.
- **Error / Disabled:** red border with a 20% red ring; disabled drops to 50% opacity.

### Cards / Containers

- **Corner Style:** 8px. **Background:** Card White / Night Card. **Border:** 10% foreground ring, no shadow. **Padding:** 16px (12px small), footer separated by a top border.

### Badges

- 20px tall, 12px medium text, 8px horizontal padding; variants default, secondary, destructive (tint), outline, ghost, link.

### Navigation

- Sidebar in Rail tone with Violet Wash selected rows and Violet Ink text; sidebar tokens mirror the main palette with their own accent and border.

### Chat (signature)

- Message bubbles, reactions, threads, attachment tiles, and code blocks (`.chat-code`: 8px radius, 8% foreground fill, copy button revealed on hover or focus). Inline code uses a 14% currentColor tint.

## Do's and Don'ts

### Do:

- **Do** use the token variables (`--primary`, `--border`, etc.) rather than raw colors so both themes stay in step.
- **Do** keep Signal Violet to actionable and selected elements.
- **Do** give every interactive element a visible focus treatment (violet border plus 1px ring).
- **Do** express danger as a tint plus colored text.
- **Do** use the shared `@zetta/ui` components before building new primitives.

### Don't:

- **Don't** add shadows to cards, lists or panels.
- **Don't** introduce a second typeface or a second accent hue.
- **Don't** use raw hex or Tailwind palette colors where a token exists.
- **Don't** surface technical vocabulary (harness, MCP, hook) in default-visible UI.
- **Don't** let status color alone carry meaning; pair it with text or an icon.

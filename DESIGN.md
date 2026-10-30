---
name: Zetta
description: An editorial control room for managing autonomous bots: warm paper and ink, one azure signal, amber reserved for attention.
colors:
  primary: "oklch(0.593 0.151 245)"
  primary-dark: "oklch(0.75 0.13 245)"
  on-primary: "oklch(0.985 0.005 85)"
  accent-wash: "oklch(0.93 0.03 245)"
  accent-ink: "oklch(0.28 0.06 245)"
  ring: "oklch(0.64 0.15 245)"
  attention: "oklch(0.72 0.16 70)"
  attention-dark: "oklch(0.8 0.15 75)"
  success: "oklch(0.5 0.11 155)"
  info: "oklch(0.5 0.11 245)"
  warn: "oklch(0.55 0.13 70)"
  destructive: "oklch(0.56 0.21 27)"
  background: "oklch(0.975 0.008 85)"
  foreground: "oklch(0.2 0.015 60)"
  card: "oklch(0.992 0.005 85)"
  secondary: "oklch(0.945 0.01 85)"
  muted-foreground: "oklch(0.48 0.02 70)"
  border: "oklch(0.88 0.012 80)"
  input: "oklch(0.86 0.012 80)"
  sidebar: "oklch(0.955 0.012 85)"
  background-dark: "oklch(0.17 0.008 70)"
  card-dark: "oklch(0.205 0.009 70)"
  sidebar-dark: "oklch(0.145 0.008 70)"
  muted-foreground-dark: "oklch(0.72 0.015 80)"
typography:
  headline:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 500
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
  meta:
    fontFamily: "Geist Mono Variable, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.08em"
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
  xl: "10px"
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

Work happens on the server; the interface stays still until something needs the user. Zetta reads as an editorial control room: warm paper and ink neutrals, one azure signal, hairline structure, and no decoration competing with bot output or attention states. When a bot is working, nothing should shout; when a person is needed, that is the loudest thing on screen.

The mood is printed and considered rather than clinical: a sans voice for headings, tight 6px corners, compact but not cramped 36px controls, and a mono voice for metadata. Enterprise teams mixing technical and non-technical people share one surface, so default flows read plainly and advanced controls sit one step deeper rather than in a different visual language.

**Key Characteristics:**

- Warm paper and ink neutrals (hue 60 to 85) with a single azure signal (hue 245). Amber (`--attention`) is the only other loud color and means "a person is needed".
- Flat, tonal layering; depth from 1px rings and surface tint, not shadows.
- Light and dark themes with equal standing (class-based `.dark`).
- Dense, scannable app chrome (sidebar, lists, chat) at 14px body.
- WCAG 2.2 AA is a requirement (PRODUCT.md); focus rings are always visible.

## Colors

A near-monochrome warm field with one azure voice. Values are OKLCH. App tokens live in `packages/ui/src/styles/globals.css`; `apps/web/src/index.css` bridges them to the `--var-*` tokens of `@g4rcez/components` and sets the status colors.

### Primary

- **Azure Signal** (`oklch(0.593 0.151 245)`): primary actions, selected state, links, checkbox/radio accent, text selection tint. In dark mode it lifts to **Azure, Lit** (`oklch(0.75 0.13 245)`) with near-black foreground text.
- **Azure Wash** (`oklch(0.93 0.03 245)`) with **Azure Ink** (`oklch(0.28 0.06 245)`): accent surfaces such as hovered menu items and sidebar selection.

### Status

Status colors are the `@g4rcez/components` tokens (`--var-color-success`, `-warn`, `-info`, `-danger`, each with `-foreground` and `-subtle`), exposed to Tailwind as `success`, `warn`, `info` and `destructive`. Use `bg-warn/10 text-warn`, never a Tailwind palette color.

- **Attention Amber** (`--attention`, `oklch(0.72 0.16 70)`): the sidebar unread badge; the loudest thing on screen. Dark `warn` is the same amber; light `warn` is a darker amber (`oklch(0.55 0.13 70)`) so text keeps contrast.
- **Success** (`oklch(0.5 0.11 155)`) and **Info** (`oklch(0.5 0.11 245)`): completed and informational states; lifted in dark mode.
- **Alarm Red** (`oklch(0.56 0.21 27)`): destructive actions and invalid fields, used as a 10% tint background with red text rather than a solid fill.

### Neutral

- **Warm Paper** (`oklch(0.975 0.008 85)`): page background. **Card Stock** (`oklch(0.992 0.005 85)`) for cards and popovers.
- **Ink** (`oklch(0.2 0.015 60)`): foreground text. **Dim Ink** (`oklch(0.48 0.02 70)`): secondary text and placeholders.
- **Hairline** (`oklch(0.88 0.012 80)`): borders; **Field Line** (`oklch(0.86 0.012 80)`) for inputs; **Mist** (`oklch(0.945 0.01 85)`) for secondary and muted fills; **Rail** (`oklch(0.955 0.012 85)`) for the sidebar.
- Dark: **Graphite** (`oklch(0.17 0.008 70)`), **Graphite Card** (`oklch(0.205 0.009 70)`), **Graphite Rail** (`oklch(0.145 0.008 70)`); borders are white at 9% and inputs white at 13%.

### Named Rules

**The One Voice Rule.** Azure marks the thing you can act on or that is selected. It never decorates. If two azure elements compete on one screen region, one of them is wrong.

**The Attention Rule.** Amber is spent only on "a person is needed". Do not use it for decoration or for ordinary warnings that need no one.

**The Tint Not Fill Rule.** Danger and attention states use a low-opacity tint with colored text, never a saturated fill, so a failed run does not out-shout a request for the user's input.

## Typography

**Heading:** Geist Variable (sans-serif, same family as body; no serif anywhere).
**UI / Body:** Geist Variable.
**Meta / Mono:** Geist Mono Variable for status labels, timestamps, keycaps, group headings (`.label-mono`) and chat code (`.chat-code`, 14px, 1.5 line height).

**Character:** An editorial voice for headings, a neutral sans for work, a mono voice for metadata. The sans stays out of the way of bot-written content.

### Hierarchy

- **Headline** (500, 1.875rem, tracking -0.025em): page titles (`h1`); dense list pages use `text-xl`.
- **Title** (500, 1.125rem): section headings (`h2`); the chat title is 1rem.
- **Body** (400, 0.875rem, sans): default UI and chat text.
- **Label** (500, 0.8125rem to 0.75rem, sans): buttons, badges, field labels.
- **Meta** (500, 11px, mono, uppercase, 0.08em tracking): `.label-mono` for sidebar groups, list group headings and day separators; timestamps are mono, sentence case.

### Named Rules

**The Two Voices Rule.** Sans speaks and works (headings, UI), mono annotates (metadata). No serif fonts. Do not set headings in mono.

## Layout

App shell: a left sidebar (tinted Rail) with the destinations grouped Work, Build and Oversee, plus a main region, behind an authenticated route group (chat, studio, agenda, dashboard, discussions, computer). Content is dense and list-driven; spacing follows Tailwind's 4px rhythm with 16px as the standard card padding (12px for small cards) and 8px between related controls. Chat, kanban and timeline views fill the available width and scroll internally; custom scrollbars are 10px thumbs at 18% foreground. Layouts must hold from phone widths up, with sheets replacing side panels on narrow screens.

## Elevation & Depth

Flat and tonal. Surfaces separate by a 1px ring (`ring-1 ring-foreground/10`) or border and by a step in surface tone (background, card, muted, rail). Shadows exist only on things that float over content.

### Shadow Vocabulary

- **Float** (`shadow-md` + 10% ring): dropdown menus and popovers.
- **Sheet** (`shadow-lg`): side and bottom sheets.
- **Field hint** (`shadow-xs`): input groups only.

### Named Rules

**The Flat-At-Rest Rule.** Cards, lists and panels carry no shadow. If something needs lifting, it should be a floating layer.

## Shapes

Soft but not round. Base radius is 0.375rem (6px) with a derived scale: sm 2px, md 4px, lg 6px, xl 10px, 2xl 14px. Buttons and inputs use md, cards lg, icon-lg buttons are full circles, scrollbar thumbs are pills. Badges in the shared package are square-cornered; treat that as an inconsistency to resolve, not a pattern to extend.

## Components

### Buttons

- **Shape:** tight (4px).
- **Primary:** Azure fill, near-white text, 36px tall, 14px horizontal padding; hover drops to 80% opacity.
- **Outline / Secondary / Ghost:** card or mist fill with hairline border; ghost shows a mist fill only on hover.
- **Destructive:** red tint with red text, deepening on hover.
- **Focus / Press:** 1px azure ring at 50% plus a azure border; 1px downward nudge on press; disabled at 50% opacity.

### Inputs / Fields

- **Style:** 40px tall, 4px radius, hairline-input border over a 40% mist fill (30% input tone in dark).
- **Focus:** azure border and 1px 50% ring.
- **Error / Disabled:** red border with a 20% red ring; disabled drops to 50% opacity.

### Cards / Containers

- **Corner Style:** 6px. **Background:** Card Stock / Graphite Card. **Border:** 10% foreground ring, no shadow. **Padding:** 16px (12px small), footer separated by a top border.

### Badges

- 20px tall, 12px medium text, 8px horizontal padding; variants default, secondary, destructive (tint), outline, ghost, link.

### Navigation

- Sidebar in Rail tone with grouped sections (mono group labels; hairlines when collapsed). The selected row has a Azure Wash fill, Azure Ink text and a 2px azure bar on its left edge; sidebar tokens mirror the main palette with their own accent and border.

### Chat (signature)

- Message bubbles, reactions, threads, attachment tiles, and code blocks (`.chat-code`: 6px radius, 8% foreground fill, copy button revealed on hover or focus). Inline code uses a 14% currentColor tint.

## Do's and Don'ts

### Do:

- **Do** use the token variables (`--primary`, `--border`, etc.) rather than raw colors so both themes stay in step.
- **Do** keep azure to actionable and selected elements, and amber to attention.
- **Do** give every interactive element a visible focus treatment (azure border plus 1px ring).
- **Do** express danger as a tint plus colored text.
- **Do** use the shared `@zetta/ui` components before building new primitives.

### Don't:

- **Don't** add shadows to cards, lists or panels.
- **Don't** introduce a fourth typeface or a second accent hue; status colors come from the `success`, `warn`, `info` and `destructive` tokens.
- **Don't** use raw hex or Tailwind palette colors (`amber-500`, `emerald-600`, …); use the tokens.
- **Don't** surface technical vocabulary (harness, MCP, hook) in default-visible UI.
- **Don't** let status color alone carry meaning; pair it with text or an icon.

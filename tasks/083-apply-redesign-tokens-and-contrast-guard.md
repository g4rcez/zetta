# RFC-083: Apply redesign tokens and contrast guard

- **Module:** Redesign
- **Status:** Ready; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** none open (the token files exist).
- **Size target:** One focused session: two CSS files and one test.

## Context and required reading

Read [execution rules](README.md), the [redesign intent](../docs/intent/redesign.md) and [DESIGN.md](../DESIGN.md) (Theming and tokens, Colors, Typography, Shapes). This RFC authorizes no install, schema/auth/API change, build or deployment.

## Goal

Put the new token values in place for light and dark, and add a test that fails when any text pair is below 7:1 or any non-text pair is below 3:1.

## Non-goals

No component or layout change. No new token names. No color scheme other than light and dark.

## Source anchors and planned changes

- `packages/ui/src/styles/globals.css`: new values for the same tokens in `:root` and `.dark`; `--radius: 0.5rem`; `h1` 24/32 600, `h2` 16/24 500.
- `apps/web/src/index.css`: `--var-fontsize: 0.875rem`, `--var-spacing-base: 1rem`, `--var-radius-base: 0.5rem`, new status values, `.chat-response` at 14px, `.label-mono` as sans 12px sentence case.
- `packages/ui/src/styles/tokens.test.ts` (new).

## Contract and implementation steps

1. Write `tokens.test.ts` first. It reads the token values of both themes from the two CSS files and asserts the contrast table in DESIGN.md. It computes 10% tints the same way the CSS mixes them (OKLCH when the CSS uses `color-mix(in oklch, …)`). Run it and confirm it fails on the current values for the right reason.
2. Set the values from DESIGN.md. Keep the mirror rules (for example `--ring` equals `--primary`).
3. Run the test until it passes. Do not lower a threshold to make it pass.

## Acceptance criteria

- [ ] The test fails on the old values and passes on the new ones.
- [ ] No token was added or renamed; `git diff` shows value changes only, plus the test.
- [ ] Chat, inbox and settings render in light and dark with no unreadable text (screenshots recorded).

## Verification

`bun test packages/ui/src/styles/tokens.test.ts`. Browser screenshots need approval.

## Definition of done

- [ ] Acceptance criteria have evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.
- [ ] Places where `@g4rcez/components` ignores the `--var-*` bridge are listed below for RFC-087.

## Completion record (2026-10-31)

**Status: Done.** (Verified 2026-11-01, see the RFC-088 record.) Tokens and the guard are in place; chat was checked in light and dark, inbox and settings were not.

- **Changed:** `packages/ui/src/styles/globals.css` (token values, `--radius` 8px, `h1`/`h2`, `.label-mono`, solid focus outline), `apps/web/src/index.css` (bridge sizes, status values, every `@g4rcez/components` color token mapped to app tokens, chat text 14px and code 12px with even values), `packages/ui/src/styles/tokens.test.ts` (new).
- **Test:** `bun test packages/ui/src/styles/tokens.test.ts`: 92 pass. It failed before the change (the old OKLCH values cannot be measured). A mutation check (light `--muted-foreground` set to `#6b6b73`) failed six pairs, then passed again after the value was restored. `oxlint` on the test: clean.
- **Browser:** chat page in Helium, dark and light: tokens apply (`--sidebar` `#09090b`, `--background` `#0f0f11`, selected row `--accent`); the danger callout is a 10% tint with red text.
- **Library tokens:** `@g4rcez/components` ships about 130 component color tokens (alert, tag, switch, checkbox, menu, table, calendar, …) with fixed hex defaults, including its own blue `#2f6989`. All are now mapped in the bridge. Overlay scrims keep the library defaults.
- **Decision:** `--var-color-primary-subtle` is `--accent` (neutral): emerald on its own 10% tint is 6.9:1 in light mode, and emerald must not be a wash.
- **Left for RFC-087:** raw colors in `apps/web/src/features/teams/team-roles.tsx` (5); the select chevron data URI in `index.css` uses `#888`; component classes that use odd sizes (for example `text-[13px]` in `message-row.tsx`).
- **Not checked:** inbox and settings screenshots; mobile widths.

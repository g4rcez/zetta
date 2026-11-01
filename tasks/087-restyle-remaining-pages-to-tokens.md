# RFC-087: Restyle the remaining pages to the tokens

- **Module:** Redesign
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Implementation / verification
- **Dependencies:** [RFC-083](083-apply-redesign-tokens-and-contrast-guard.md), [RFC-084](084-rebuild-sidebar-shell-for-chat-first-redesign.md)
- **Size target:** One session per two or three pages.

## Context and required reading

Read [DESIGN.md](../DESIGN.md) and the RFC-083 completion record (places where `@g4rcez/components` ignores the bridge).

## Goal

Inbox, Tasks, Routines, Studio, Dashboard, Computer, settings, onboarding and login use only tokens, the new density and the shared empty, loading and error states.

## Non-goals

No behavior change on these pages. No new pages.

## Source anchors and planned changes

- `apps/web/src/routes/` and `apps/web/src/features/` for each page.
- Search `apps/web/src` for raw colors and palette classes (`#`, `emerald-`, `zinc-`, `amber-`, `text-[11px]`, odd pixel values) and replace them with tokens and even values.

## Acceptance criteria

- [ ] The search above returns no matches in product code.
- [ ] Every page renders in light and dark with its empty, loading and error states.

## Verification

The raw-color search and `bun test packages/ui/src/styles/tokens.test.ts`. Browser screenshots need approval.

## Definition of done

- [ ] Acceptance criteria have evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.

## Completion record (2026-11-01)

**Status: Done.** (Verified 2026-11-01, see the RFC-088 record.) Code pass done; the pages were not each captured in a browser.

- **Sizes:** every arbitrary text size in `apps/web/src` moved to the scale (10/11px → 12px, 13/15px → 14px); `grep text-\[..px\]` now finds none. Decorative mono removed from the work timeline; mono stays for code and identifiers.
- **Shared primitives:** `packages/ui` button 32px default (28px small, 24px tiny), hover toward the text color instead of 80% opacity, solid focus outline; input 32px on `--card`; badge 4px radius. `@g4rcez/components` control heights set in the bridge (32/28/24/40px).
- **Colors:** team role chips keep the user's color on the icon only, with the name in `--foreground` on `--muted` (7:1). Telegram page controls use the primary tokens (white on Telegram blue was 2.9:1); the logo carries the brand.
- **Kept on purpose:** bot avatar art and service logos (Telegram, Google, Reddit) are artwork; `whatsapp-view.tsx` mimics WhatsApp to preview its messages; the select chevron `#888` is a decorative icon that passes 3:1 on both grounds.
- **Checks:** contrast guard 92 pass; `oxlint apps/web/src` clean; web `tsc` has no errors in changed files.

# RFC-088: Verify the redesign's accessibility and finish

- **Module:** Redesign
- **Status:** Done; see [root index](../TASKS.md).
- **Type:** Verification
- **Dependencies:** [RFC-083](083-apply-redesign-tokens-and-contrast-guard.md) to [RFC-087](087-restyle-remaining-pages-to-tokens.md)
- **Size target:** One session.

## Context and required reading

Read [DESIGN.md](../DESIGN.md), [PRODUCT.md](../PRODUCT.md) (Accessibility) and every redesign completion record.

## Goal

Prove that the shipped app matches DESIGN.md and meets WCAG 2.2 AA with 7:1 text contrast, then record the built design.

## Non-goals

No new features. Fixes go back to the owning RFC unless they are one-line token or label changes.

## Contract and implementation steps

1. Run axe on every page in light and dark; do a keyboard-only pass of the shell, the chat and the bot reorder.
2. Run the Impeccable finish review against DESIGN.md with screenshots at 390 and 1440px.
3. Regenerate `.impeccable/design.json` from the built app; update DESIGN.md only where the build is right and the document is wrong.

## Acceptance criteria

- [ ] No axe violations; the contrast test passes.
- [ ] The finish review verdict is "ship".
- [ ] `.impeccable/design.json` describes the new design.

## Verification

Approved browser runs only; record exact commands and results.

## Definition of done

- [ ] Acceptance criteria have evidence and the [shared definition of done](README.md#shared-definition-of-done) is satisfied.

## Completion record (2026-11-01)

**Status: Done.** Finish review passed and axe reports 0 violations on every checked page in both themes.

- **Finish review:** a fresh Impeccable finish reviewer judged the build against DESIGN.md and the confirmed intent: disposition "fix" with 8 material fixes, all applied; the verdict passes scored 8/8 resolved, disposition "ship" (scope: the scored fixes). Fixes: Bots heading fit and no horizontal scroll, Rooms in the collapsed rail, combobox chat switcher with search, Title-style chat title, no harness/model in tooltips, amber only for attention (favorite star, Inbox dots), `--input` borders on the filter and outline buttons, no `--var-*` outside the bridge, 60% overlay without blur, sidebar tree keys (↑/↓, →/←, `aria-controls`), one `aria-current="page"`, full-width chat titles. Also: popovers 8px radius with a 1px `--border`, no side stripes in the Studio and bot settings navs, bot pages inside the shell.
- **Contract:** the user pinned the direction in the interview; no concept roll ran, so there is no seed reference (recorded in docs/intent/redesign.md).
- **Captures** (`.impeccable/review/`, git-ignored because they show personal data): chat dark and light, details panel, switcher, rail, rooms, inbox, tasks, bot settings, phone top bar and sheet in dark and light.
- **Keyboard:** sidebar tree, Alt+↑/↓ reorder, switcher combobox and Escape driven in the browser; pointer drag reorder also saved to the database (order restored afterwards).
- **Sidecar:** `.impeccable/design.json` regenerated from the built code by the Impeccable documenter; it also corrected six DESIGN.md facts to match the code (badge padding, input focus ring, code block fills, 150ms hover, bot avatar art).
- **Checks:** contrast guard 92 pass; web suite 143 pass; `oxlint` clean on `apps/web/src` and `packages/ui/src`; web `tsc` has only the 3 errors that predate this work; server `tsc` clean; preferences integration test 5 pass.
- **axe:** the user approved `axe-core` 4.14.0 as a dev dependency of `apps/web` (MPL-2.0, no dependencies, no install scripts). `apps/web/src/dev/axe-report.ts` runs it in development builds only when the URL has `?axe` (WCAG 2.0–2.2 A/AA plus AAA contrast) and prints the result on the page. First run on the chat page: 6 rules (WhatsApp preview contrast and timestamps, two names that did not start with their visible text, a `li` with `role="group"`, an unfocusable scroll region, 20px caret targets); bot settings: 2 (emerald text on emerald tint, an unlabeled file input). All fixed. Final run: chat, rooms, inbox, tasks and bot settings, in dark and in light: 0 violations each (10 scans).
- **Screen reader:** the accessibility tree of the sidebar, switcher and rail was read: every control is named, groups are toggle buttons with `aria-expanded`, lists nest, the time toggle is pressed/unpressed. Fixed: the Inbox count read "Inbox , 1 unread". A listening pass with VoiceOver audio was not run.
- **20 bots:** skipped by the user's choice; the ordering rules are unit-tested (`bot-order.test.ts`).
- **Lockfile note:** `bun add` also synced `bun.lock` with manifests already committed (`agent-browser` in `apps/server`, which the root `package.json` trusts; `playwright-core` dropped).
- **Decisions (user, 2026-11-01):** the Zetta mark stays the robot art, and a new chief is named "Zetta" by default (`apps/server/src/modules/chat/service.ts`; existing chiefs keep their names; users can rename). Bot avatar art is exempt from the token, gradient and shadow rules (DESIGN.md). The user drives the remaining browser checks (switcher Enter path, phone-sheet overlay) themselves.
- **Chief name tests:** `discussions.integration.test.ts` now expects "Zetta" for the provisioned chief (`@Zetta` mentions, reply fixtures keyed by name); those two tests pass on a scratch database. Two other tests in that file fail for reasons unrelated to this work: an allowlist approval message and a non-private chief fixture refused by `bot_chief_private_check`.

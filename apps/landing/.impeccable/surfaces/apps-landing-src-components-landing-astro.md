---
version: 1
slug: "apps-landing-src-components-landing-astro"
primary_target: "apps/landing/src/components/Landing.astro"
related_targets: []
---

# Zetta landing page (apps/landing)

Mode: Persuade. Visitor: a team lead or self-hoster. Action: self-host from GitHub. Proof: real light-mode screenshots of the app with demo data; no customers, prices, metrics or star counts. English and pt-BR, WCAG AAA text contrast, DESIGN.md tokens only. Four sections in `<main>`.

History: the CopilotKit-style page was rejected, then a transit-map page was rejected on 2026-11-05 ("layout is terrible"). The user asked for a copy of linear.app in light mode. A literal copy was declined (DESIGN.md: never copy a competitor's text, logo, illustrations or exact layout). Built instead: a product-led page in the manner the app itself follows, with Zetta's own copy and Zetta's own screenshots.

## Direction contract

THESIS: The product is the page. A left-aligned headline, then the real app in a hairline frame, then alternating screenshot-and-text rows (Inbox, chat, tasks, routines), a plain integrations list and the self-host steps. It refuses diagrams, card grids and invented proof.

OWN-WORLD: Light --background with --sidebar bands, 1px --border frames, 12px radius, no shadows, no gradients. Geist 600 at tight tracking, Geist Mono for commands. Emerald on actions only, amber never used outside screenshots.

STORY: The visitor sees the app itself, understands that attention is asked for only when needed, and copies the install command.

FIRST VIEWPORT: Sticky header, 80px H1 left-aligned, lead, two actions, MIT note, then the Chief chat screenshot in a frame.

FORM: product-led screenshot page, user-requested manner of linear.app (composition only). seed: none (user-directed)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

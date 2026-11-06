---
version: 1
slug: "apps-landing-src-components-landing-astro"
primary_target: "apps/landing/src/components/Landing.astro"
related_targets: []
---

# Zetta landing page (apps/landing)

Mode: Persuade. Visitor: a team lead or self-hoster. Action: self-host from GitHub. Proof: real light-mode screenshots and recordings of the app with demo data; no customers, prices, metrics or star counts. English and pt-BR, WCAG AAA text contrast, DESIGN.md tokens only. Fonts stay Geist and Geist Mono; the main color is emerald.

History: a transit-map page was rejected on 2026-11-05 ("layout is terrible"). A product-led screenshot page followed. On 2026-11-06 the user asked for a bolder editorial rebuild: a robot-led hero, a big recording, a bento of what the bots do, an approvals band, an agents section, the chief, install steps, a FAQ and one dark closing band. Built with Zetta's own copy, layout code and art.

## Direction contract

THESIS: The robot and the product are the page. A large headline with one emerald phrase per section, the Zetta robot lowering its goggles in the hero, a real light-mode recording, a bento of real screens and small illustrations, and a working Approve card.

OWN-WORLD: Light --background with a primary-tinted band for approvals, 24px-radius tiles with a hairline and a soft shadow, pill buttons, one dark ink band (closing CTA and a small footer). Geist 600 at tight tracking, Geist Mono for commands. Emerald is the main color; amber appears only where a person is needed.

STORY: The visitor meets the robot, watches the app turn a brief into a team, sees that only risky actions wait for them, and copies the install command.

FIRST VIEWPORT: Clear sticky header, an eyebrow line, a three-line H1 with a hand-drawn emerald stroke under one word, lead, the install command, two actions, and the robot on a tile with four bots floating around it.

MOTION: One goggles drop on load (replayable on hover), a slow dashed ring, floating bot chips, scroll reveals, clips that play only in view. All of it stops for reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

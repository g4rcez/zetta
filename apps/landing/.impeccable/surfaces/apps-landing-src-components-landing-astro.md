---
version: 1
slug: "apps-landing-src-components-landing-astro"
primary_target: "apps/landing/src/components/Landing.astro"
related_targets: []
---

# Zetta landing page (apps/landing)

Mode: Persuade. Visitor: a team lead or self-hoster deciding whether to run Zetta. Action: self-host from GitHub. Proof: illustrated, labeled synthetic runs; no customers, press, prices, star counts or metrics. Constraints: English and pt-BR, WCAG AAA text contrast, DESIGN.md tokens only (Geist, emerald for actions, amber for "needs you"). Build path: code-led (no image generation). The user pinned the direction: follow the section order and composition of https://www.copilotkit.ai/ in the Zetta world, with a hub diagram as the hero visual and no audience toggle. Layout is borrowed; copy, logos, illustrations and colors are not.

## Direction contract

THESIS: The page is a product site in the CopilotKit composition with four sections and a close: sticky header, centered hero over one diagram (what Zetta is), a rotating tabbed showcase of example runs, bordered feature cards (three scenes, six text cards), a self-host panel, and a centered call to star the repository on GitHub (no star count). It refuses the old emerald band and run receipt, and refuses invented proof.

OWN-WORLD: Light airy ground (--background) alternating with --sidebar bands. Bordered --card panels with 16px radius and 1px --border, no shadows, no gradients. Emerald only on actions and the hub's center. Amber only on the one "Needs you" node and row. Geist 600 at tight tracking for centered headings, Geist Mono only for code and times. Illustration is the product's own art, never invented: the bot characters from the app (src/cast.ts, one character per named bot) and the vendor marks from the plugin catalog. They are the only color besides emerald and amber, and every face or mark sits next to its written name.

STORY: The visitor sees one chief coordinating bots, agents and apps, then watches an ask become work, a blocked login and an approval request. They believe the bots work unattended and report honestly. They copy the install command.

FIRST VIEWPORT: Sticky white header (logo, five links, language, GitHub ghost, primary Self-host). Below it a centered H1 at 80px max, a 20px lead, primary "Self-host Zetta" and secondary "Star on GitHub", then the MIT note. The hub diagram starts directly under the note: the chief tile in the center on a --card panel, lines to bots on the left, agents on the right, and one amber "Needs you" node, each bot wearing its character. Signature interaction: on load the run plays once (about 3.5 s): the ask, the chief's ring, wires drawn in emerald then settling, bots and agents arriving, and Writer switching to "Needs you". Reduced motion shows the finished scene. A dotted canvas sits behind the diagram.

FORM: CopilotKit-style product landing, pinned by the user. seed: none (user-pinned: follow copilotkit.ai; no roll ran)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

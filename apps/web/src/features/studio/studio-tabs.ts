/** `blurb` is the one-line description under the page title and on the Overview. */
export const studioTabs = [
  {
    slug: "overview",
    label: "Overview",
    blurb: "Your bots' engines, accounts and rules at a glance.",
  },
  {
    slug: "attention",
    label: "Inbox",
    blurb: "Things that need you, with the actions to deal with them.",
  },
  {
    slug: "output-styles",
    label: "Output styles",
    blurb: "How your bots write. Tone templates you can share.",
  },
  { slug: "workflows", label: "Workflows", blurb: "Chain steps across bots and sources." },
  {
    slug: "decisions",
    label: "Decisions",
    blurb: "Picks between options for workflows and bot routing, on this server.",
  },
  {
    slug: "accounts",
    label: "Accounts",
    blurb: "The engines that run your bots and the provider keys they use.",
  },
  { slug: "computer", label: "Computer", blurb: "Browser and desktop sessions." },
  {
    slug: "plugins",
    label: "Plugins",
    blurb: "Connect tools and MCP servers, then choose which bots may use them.",
  },
  {
    slug: "snapshots",
    label: "Team snapshots",
    blurb: "Read-only copies of chats shared with your team.",
  },
  { slug: "activity", label: "Activity", blurb: "A privacy-safe trail of what your bots did." },
] as const;

export type StudioTab = (typeof studioTabs)[number]["slug"];

export const isStudioTab = (value: string): value is StudioTab =>
  studioTabs.some((t) => t.slug === value);

/** Studio sections promoted to the main app rail; the Studio side nav lists the rest. */
export const railTabs: readonly StudioTab[] = ["attention", "plugins", "computer"];
export const isRailTab = (slug: string) => railTabs.includes(slug as StudioTab);

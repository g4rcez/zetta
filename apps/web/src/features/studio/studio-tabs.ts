export const studioTabs = [
  { slug: "attention", label: "Inbox" },
  { slug: "output-styles", label: "Output styles" },
  { slug: "workflows", label: "Workflows" },
  { slug: "decisions", label: "Decisions" },
  { slug: "accounts", label: "Accounts" },
  { slug: "computer", label: "Computer" },
  { slug: "plugins", label: "Plugins" },
  { slug: "snapshots", label: "Team snapshots" },
  { slug: "activity", label: "Activity" },
] as const;

export type StudioTab = (typeof studioTabs)[number]["slug"];

export const isStudioTab = (value: string): value is StudioTab =>
  studioTabs.some((t) => t.slug === value);

/** Studio sections promoted to the main app rail; the Studio side nav lists the rest. */
export const railTabs: readonly StudioTab[] = ["attention", "plugins", "computer"];
export const isRailTab = (slug: string) => railTabs.includes(slug as StudioTab);

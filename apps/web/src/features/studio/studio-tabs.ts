export const studioTabs = [
  { slug: "routines", label: "Routines" },
  { slug: "attention", label: "Notifications" },
  { slug: "knowledge", label: "Knowledge" },
  { slug: "wiki", label: "Wiki" },
  { slug: "instructions", label: "Instructions" },
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
export const railTabs: readonly StudioTab[] = ["routines", "attention", "plugins", "computer"];
export const isRailTab = (slug: string) => railTabs.includes(slug as StudioTab);

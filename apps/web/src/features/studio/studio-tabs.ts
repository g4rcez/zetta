export const studioTabs = [
  { slug: "routines", label: "Routines" },
  { slug: "attention", label: "Attention" },
  { slug: "knowledge", label: "Knowledge" },
  { slug: "workflows", label: "Workflows" },
  { slug: "decisions", label: "Decisions" },
  { slug: "accounts", label: "Accounts" },
  { slug: "computer", label: "Computer" },
  { slug: "plugins", label: "Plugins" },
  { slug: "snapshots", label: "Team snapshots" },
  { slug: "activity", label: "Activity" },
] as const;

export type StudioTab = (typeof studioTabs)[number]["slug"];

export const isStudioTab = (value: string): value is StudioTab => studioTabs.some((t) => t.slug === value);

/**
 * Where the Skills page looks first, and the only places its search covers. A source is listed here when it is published by the
 * vendor's own organisation (`official`), or when it is kept by an individual maintainer the Zetta owners chose to trust (`trusted`).
 * Anything else can still be installed by pasting its address, but it is marked as not trusted and always needs the person's approval.
 * To add one: confirm the repository, add a line with a short reason, and keep each source to skills people actually ask for.
 */
export type Trust = "official" | "trusted";
export type Suggestion = { repo: string; blurb: string; trust: Trust };

export const SUGGESTIONS: readonly Suggestion[] = [
  { repo: "anthropics/skills", blurb: "Skills published by Anthropic.", trust: "official" },
  {
    repo: "cursor/plugins",
    blurb: "Cursor's official plugins and the skills inside them.",
    trust: "official",
  },
  {
    repo: "vercel-labs/agent-skills",
    blurb: "Vercel's skills for coding agents.",
    trust: "official",
  },
  {
    repo: "vercel-labs/skills",
    blurb: "The skills.sh project, including find-skills.",
    trust: "official",
  },
  {
    repo: "expo/skills",
    blurb: "Skills for building apps with Expo and React Native.",
    trust: "official",
  },
  {
    repo: "addyosmani/agent-skills",
    blurb: "Production-grade engineering skills by Addy Osmani.",
    trust: "trusted",
  },
  {
    repo: "mattpocock/skills",
    blurb: "Skills for TypeScript and everyday engineering by Matt Pocock.",
    trust: "trusted",
  },
];

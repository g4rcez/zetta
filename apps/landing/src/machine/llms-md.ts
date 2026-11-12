import { REPO, SITE } from "../links";
import { changelogMarkdown, type ChangelogDay } from "./changelog";

export type LlmsGuide = { slug: string; title: string; summary: string; markdown: string };
export type LlmsInput = {
  /** The one-line description of Zetta (the page's meta description). */
  description: string;
  /** The home page as Markdown, and the chosen sections of the README. */
  home: string;
  readme: string;
  guides: readonly LlmsGuide[];
  days: readonly ChangelogDay[];
};

/** `/llms.txt` (https://llmstxt.org): what Zetta is in a few lines, and a link to the Markdown of every page the site publishes. */
export function buildLlmsTxt({
  description,
  guides,
}: Pick<LlmsInput, "description" | "guides">): string {
  const out = [
    "# Zetta",
    "",
    `> ${description}`,
    "",
    "Zetta is free and open source (MIT) and runs on your own server. Every page of this site has a Markdown twin (add `.md` to its address); the links below are those twins.",
    "",
    "## Docs",
    "",
    `- [Home](${SITE}/index.md): what Zetta is, what it does and how to install it`,
    ...guides.map(
      (p) => `- [${p.title}](${SITE}/docs/${p.slug}.md)${p.summary ? `: ${p.summary}` : ""}`,
    ),
    "",
    "## Optional",
    "",
    `- [Changelog](${SITE}/changelog.md): what changed, newest first`,
    `- [Changelog as JSON](${SITE}/changelog.json): the same, for scripts`,
    `- [Everything in one file](${SITE}/llms-full.txt): the home page, the README and the guide, joined`,
    `- [Português (Brasil)](${SITE}/pt-br/index.md): the home page in Portuguese`,
    `- [Repository](${REPO}): the source code`,
  ];
  return `${out.join("\n")}\n`;
}

/** `/llms-full.txt`: the content behind every link of `llms.txt` in one file, so one request is enough. */
export function buildLlmsFull({
  home,
  readme,
  guides,
  days,
}: Omit<LlmsInput, "description">): string {
  const parts = [
    home.trimEnd(),
    `## From the README\n\n${readme}`,
    "## User guide\n\nThe guide describes the intended v1 journey, not a finished tutorial.",
    ...guides.map((p) => p.markdown.trimEnd()),
    changelogMarkdown(days).trimEnd(),
  ];
  return `${parts.join("\n\n---\n\n")}\n`;
}

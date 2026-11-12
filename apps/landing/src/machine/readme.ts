import { REPO } from "../links";

/** The parts of the repository's README a visitor needs; the rest (demo videos, interface references) is for people in the repository. */
export const README_SECTIONS = [
  "Install",
  "The experience",
  "What bots do",
  "V1 capabilities",
  "Boundaries",
] as const;

/** The `## ` sections of a README, by heading. Text before the first section is not a section. */
export function readmeSections(raw: string): Map<string, string> {
  const sections = new Map<string, string>();
  let name: string | undefined;
  let lines: string[] = [];
  const flush = () => name && sections.set(name, lines.join("\n").trim());
  for (const line of raw.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      name = heading[1]!;
      lines = [];
    } else if (name) lines.push(line);
  }
  flush();
  return sections;
}

/** Pictures and videos do not travel in text; a relative link points at the file on GitHub. */
function forText(markdown: string): string {
  return markdown
    .replace(/^\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\s*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(
      /\[([^\]]+)\]\(((?!https?:|mailto:|#)[^)\s]+)\)/g,
      (_, text: string, href: string) =>
        `[${text}](${REPO}/blob/main/${href.replace(/^\.\//, "")})`,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The chosen sections of the README as Markdown, each under its own heading, in the README's order. */
export function readmeMarkdown(raw: string, wanted: readonly string[] = README_SECTIONS): string {
  const sections = readmeSections(raw);
  return [...sections.keys()]
    .filter((name) => wanted.includes(name))
    .map((name) => `### ${name}\n\n${forText(sections.get(name)!)}`)
    .join("\n\n");
}

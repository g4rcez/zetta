import { REPO } from "../links";

export const CHANGELOG_TYPES = ["feat", "fix", "perf"] as const;
export type ChangelogType = (typeof CHANGELOG_TYPES)[number];
export type ChangelogEntry = { type: ChangelogType; scope: string; subject: string; sha: string };
/** The changes of one UTC day, newest day first (see scripts/changelog.ts, which writes the file). */
export type ChangelogDay = { day: string; entries: ChangelogEntry[] };

const LABEL: Record<ChangelogType, string> = { feat: "New", fix: "Fixed", perf: "Faster" };

/** The changelog as Markdown: a heading per day, a line per change with its type, scope and a link to the commit. */
export function changelogMarkdown(days: readonly ChangelogDay[]): string {
  const out = [
    "# Changelog",
    "",
    "What changed in Zetta, newest first. One section per UTC day.",
    "",
  ];
  for (const d of days) {
    out.push(`## ${d.day}`, "");
    for (const e of d.entries)
      out.push(
        `- **${LABEL[e.type]}**${e.scope ? ` (${e.scope})` : ""}: ${e.subject} ([${e.sha}](${REPO}/commit/${e.sha}))`,
      );
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

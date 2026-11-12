// Writes apps/landing/src/data/changelog.json from the git history: the feat, fix and perf commits, grouped by UTC day, newest first.
// Run it by hand (`bun run changelog`) and commit the file. The site build never runs git, because Vercel clones only the newest commit.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ChangelogDay,
  ChangelogEntry,
  ChangelogType,
} from "../apps/landing/src/machine/changelog";

// "feat(chat): subject", "fix: subject", "feat(web)!: subject". Other types (docs, test, chore, refactor...) are not news to a visitor.
const SUBJECT = /^(feat|fix|perf)(?:\(([^)]*)\))?!?:\s*(.+)$/;
const FIELD = "\x1f";
export const LOG_FORMAT = `%H${FIELD}%cI${FIELD}%s`;

/** Reads `git log --format=LOG_FORMAT` (newest first) into days. A commit that is not feat, fix or perf is left out. */
export function parseLog(log: string): ChangelogDay[] {
  const byDay = new Map<string, ChangelogEntry[]>();
  for (const line of log.split("\n")) {
    const [sha, committed, subject] = line.split(FIELD);
    const match = subject ? SUBJECT.exec(subject.trim()) : null;
    if (!sha || !committed || !match) continue;
    const when = new Date(committed);
    if (Number.isNaN(when.getTime())) continue;
    const day = when.toISOString().slice(0, 10);
    const entries = byDay.get(day) ?? [];
    entries.push({
      type: match[1] as ChangelogType,
      scope: match[2]?.trim() ?? "",
      subject: match[3]!.trim(),
      sha: sha.slice(0, 7),
    });
    byDay.set(day, entries);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, entries]) => ({ day, entries }));
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const git = spawnSync("git", ["log", "--no-merges", `--format=${LOG_FORMAT}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (git.status !== 0) {
    console.error(git.stderr || "git log failed");
    process.exit(1);
  }
  const days = parseLog(git.stdout);
  writeFileSync(
    join(root, "apps/landing/src/data/changelog.json"),
    `${JSON.stringify(days, null, 2)}\n`,
  );
  console.log(`${days.length} days, ${days.reduce((n, d) => n + d.entries.length, 0)} changes`);
}

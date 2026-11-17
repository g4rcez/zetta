/**
 * The update check, without any I/O: what a build is, how the published changelog is read, and how the two are compared. The server
 * fetches the feed; the web app only reads the result. Only erasable syntax: the web app imports this file too.
 */

/** The commit a server was built from and the date of that commit (ISO 8601). */
export type BuildInfo = { commit: string; date: string };

/** `current`: nothing newer is published. `behind`: newer changes exist. `unknown`: no build stamp, no feed, or the check is off. */
export const UPDATE_STATES = ["current", "behind", "unknown"] as const;
export type UpdateState = (typeof UPDATE_STATES)[number];

export const UPDATE_CHECK_MODES = ["on", "off"] as const;
export type UpdateCheckMode = (typeof UPDATE_CHECK_MODES)[number];

/** One change of the published changelog (see scripts/changelog.ts), with the UTC day it landed on. */
export type UpdateChange = {
  day: string;
  type: "feat" | "fix" | "perf";
  scope: string;
  subject: string;
  sha: string;
};

/** The most changes the check keeps and shows. */
export const MAX_UPDATE_CHANGES = 30;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPES: readonly string[] = ["feat", "fix", "perf"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** A commit date as the UTC day the changelog groups it under, or undefined when it is not a date. */
export function dayOf(date: string): string | undefined {
  const t = Date.parse(date);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

/**
 * Reads the changelog feed (an array of `{ day, entries: [{ type, scope, subject, sha }] }`, newest day first). Anything that does not
 * fit is dropped; null when the feed is not a list at all. The text is cut to a length, never trusted beyond that.
 */
export function parseFeed(json: unknown): UpdateChange[] | null {
  if (!Array.isArray(json)) return null;
  const out: UpdateChange[] = [];
  for (const d of json) {
    if (!d || typeof d !== "object") continue;
    const { day, entries } = d as { day?: unknown; entries?: unknown };
    if (typeof day !== "string" || !DAY.test(day) || !Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const x = e as Record<string, unknown>;
      if (typeof x.type !== "string" || !TYPES.includes(x.type)) continue;
      const subject = text(x.subject, 200).trim();
      if (!subject) continue;
      out.push({
        day,
        type: x.type as UpdateChange["type"],
        scope: text(x.scope, 40).trim(),
        subject,
        sha: text(x.sha, 40).replace(/[^0-9a-f]/gi, ""),
      });
    }
  }
  return out;
}

export type UpdateVerdict = {
  state: UpdateState;
  /** The newest day the feed publishes. */
  latest: { date: string } | null;
  /** Changes newer than the build, newest first, at most `MAX_UPDATE_CHANGES`. */
  changes: UpdateChange[];
};

/**
 * Compares a build with the feed. The changelog is grouped by UTC day, so the comparison is by day: a build is `behind` when the feed
 * has a day after the day of its commit. A build without a date, or an empty feed, is `unknown`.
 */
export function compareToFeed(
  build: Pick<BuildInfo, "date"> | null,
  feed: readonly UpdateChange[] | null,
): UpdateVerdict {
  const buildDay = build ? dayOf(build.date) : undefined;
  if (!buildDay || !feed || feed.length === 0)
    return { state: "unknown", latest: null, changes: [] };
  const latest = feed.reduce((a, c) => (c.day > a ? c.day : a), feed[0]!.day);
  const newer = feed
    .filter((c) => c.day > buildDay)
    .sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? 1 : -1));
  return {
    state: newer.length > 0 ? "behind" : "current",
    latest: { date: latest },
    changes: newer.slice(0, MAX_UPDATE_CHANGES),
  };
}

/** The one command that updates an installation: the installer pulls the code, keeps the .env files and rebuilds (see install.sh). */
export const UPDATE_COMMAND = "curl -fsSL https://zettabot.app/install | bash";

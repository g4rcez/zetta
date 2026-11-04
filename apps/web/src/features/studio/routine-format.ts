import { relativeTime } from "../shared/relative-time";

export type SummaryRoutine = {
  title: string;
  paused: boolean;
  status?: string;
  nextRunAt: string | null;
};

/** The one-sentence state of the page: what is running, what needs a person, and what comes next. */
export function summarize(rows: readonly SummaryRoutine[], now: number, locale?: string) {
  const running = rows.filter((r) => r.status === "running").length;
  const attention = rows.filter(
    (r) => r.status === "failed" || r.status === "interrupted" || r.status === "blocked",
  ).length;
  const upcoming = rows
    .filter((r) => !r.paused && r.nextRunAt)
    .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];
  const parts: string[] = [];
  if (running) parts.push(`${running} running now`);
  if (attention) parts.push(`${attention} need${attention === 1 ? "s" : ""} attention`);
  if (upcoming)
    parts.push(`Next: ${upcoming.title} ${relativeTime(upcoming.nextRunAt!, now, locale)}`);
  return parts.length
    ? parts.join(" · ")
    : rows.length
      ? "Nothing is running and nothing is scheduled."
      : "";
}

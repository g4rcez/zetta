const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "in 3 hours" / "20 minutes ago"; under a minute reads "now" so a countdown never flickers through seconds. */
export function relativeTime(iso: string, now: number, locale?: string) {
  const diff = new Date(iso).getTime() - now;
  if (Math.abs(diff) < 60_000) return "now";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of UNITS)
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  return "now";
}

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

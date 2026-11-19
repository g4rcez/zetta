import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "../chat/chat-client";
import { ChartView, type AxisData } from "../chat/chart";
import type { SectionProps } from "../bot-quality/sections";
import { learningQueries, type BotProgress } from "./learning-api";

const weekLabel = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Step-ins per 100 replies, one point per week that had judged replies. A quiet week is left out: drawn as 0 it would read as "no step-ins". */
export function progressChart(p: BotProgress): AxisData {
  const weeks = p.weeks.filter((w) => w.per100 !== null);
  return {
    type: "line",
    categories: weeks.map((w) => weekLabel.format(new Date(`${w.start}T00:00:00Z`))),
    series: [{ name: "Step-ins per 100 replies", values: weeks.map((w) => w.per100 ?? 0) }],
  };
}

/** One honest sentence about the last four weeks against the four before; says so when there is too little to compare. */
export function progressSentence(p: BotProgress): string {
  const { recent, earlier } = p;
  if (!recent) return "Not enough judged replies in the last four weeks to say anything yet.";
  if (!earlier)
    return `You stepped in ${recent.per100} times per 100 replies in the last four weeks. There is no earlier period to compare with yet.`;
  const delta = Math.round((recent.per100 - earlier.per100) * 10) / 10;
  if (Math.abs(delta) < 2)
    return `About the same as before: ${recent.per100} step-ins per 100 replies, against ${earlier.per100} in the four weeks before.`;
  return delta < 0
    ? `Better: ${recent.per100} step-ins per 100 replies in the last four weeks, down from ${earlier.per100} (${Math.abs(delta)} fewer).`
    : `Worse: ${recent.per100} step-ins per 100 replies in the last four weeks, up from ${earlier.per100} (${delta} more).`;
}

const changed = (p: BotProgress) => p.weeks.filter((w) => w.started || w.kept || w.dropped);

/** Is this bot getting better? How often you had to step in, week by week, with the lessons that changed beside it. */
export function ProgressSection({ bot }: SectionProps) {
  const q = useQuery(learningQueries.progress(bot.id));
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(q.error)}
      </p>
    );
  const p = q.data;
  const marks = changed(p);
  const has = p.weeks.some((w) => w.replies > 0);
  return (
    <div className="space-y-4">
      <p className="text-sm text-pretty" role="status">
        {progressSentence(p)}
      </p>
      {has ? (
        <ChartView title="Step-ins per 100 replies, by week" chart={progressChart(p)} fill />
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing to draw yet. A reply counts once Zetta can tell whether you stepped in: you
          stopped it, redirected it, corrected it or rated it down.
        </p>
      )}
      {marks.length > 0 && (
        <section aria-label="Lessons by week" className="space-y-1">
          <h3 className="text-sm font-medium">Lessons that changed</h3>
          <ul className="m-0 list-none space-y-0.5 p-0 text-xs text-muted-foreground">
            {marks.map((w) => (
              <li key={w.start}>
                Week of {weekLabel.format(new Date(`${w.start}T00:00:00Z`))}:{" "}
                {[
                  w.started && `${w.started} started`,
                  w.kept && `${w.kept} kept`,
                  w.dropped && `${w.dropped} dropped`,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-pretty text-muted-foreground">
        On trial {p.lessons.trial} · kept {p.lessons.kept} · dropped {p.lessons.dropped}
        {p.lessons.waiting ? ` · waiting for you ${p.lessons.waiting}` : ""}. Only replies Zetta
        could judge from what you did are counted; it never asks a model whether an answer was good.
      </p>
    </div>
  );
}

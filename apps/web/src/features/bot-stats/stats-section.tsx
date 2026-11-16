import { useQuery } from "@tanstack/react-query";

import { errorMessage } from "../chat/chat-client";
import { ChartView, type AxisData } from "../chat/chart";
import { compact } from "../chat/chart-math";
import type { SectionProps } from "../bot-quality/sections";
import { botStatsQueries, type BotActivity } from "./bot-stats-api";

const dayLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const num = (n: number) => new Intl.NumberFormat("en").format(n);

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  /** Already formatted: 1,234 or 1.5M. */
  value: string;
  note: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className="m-0 truncate text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

const TOKEN_PARTS = [
  { key: "input", label: "New input" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "output", label: "Output" },
] as const;

/** Where the tokens went: one thin bar in four parts, named below with their counts (the bar is never the only cue). */
function TokenUsage({ a }: { a: BotActivity }) {
  const t = a.tokens;
  const calls = a.calls.last30;
  if (calls === 0) return null;
  if (t.reportedCalls === 0)
    return (
      <p className="text-sm text-pretty text-muted-foreground">
        Tokens are not reported for this bot's calls. Only Claude Code reports them.
      </p>
    );
  return (
    <section aria-label="Token usage" className="space-y-2">
      <h3 className="text-sm font-medium">Tokens</h3>
      <div
        role="img"
        aria-label={`${num(t.total)} tokens: ${TOKEN_PARTS.map((p) => `${p.label} ${num(t[p.key])}`).join(", ")}`}
        className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted"
      >
        {TOKEN_PARTS.map((p, i) =>
          t[p.key] > 0 ? (
            <span
              key={p.key}
              className="h-full min-w-0.5"
              style={{ flex: `${t[p.key]} 0 0`, backgroundColor: `var(--viz-${i + 1})` }}
            />
          ) : null,
        )}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-xs text-muted-foreground">
        {TOKEN_PARTS.map((p, i) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: `var(--viz-${i + 1})` }}
            />
            {p.label}
            <span className="tabular-nums text-foreground">{compact(t[p.key])}</span>
          </li>
        ))}
        <li className="ml-auto tabular-nums">
          {compact(Math.round(t.total / t.reportedCalls))} per call
          {t.reportedCalls < calls
            ? ` · ${num(t.reportedCalls)} of ${num(calls)} calls reported`
            : ""}
        </li>
      </ul>
    </section>
  );
}

/** The bot's volume of work over the last 30 days, as one line per kind of work. */
export function activityChart(a: BotActivity): AxisData {
  return {
    type: "line",
    categories: a.days.map((d) => dayLabel.format(new Date(`${d}T00:00:00Z`))),
    series: [
      { name: "Calls", values: a.series.calls },
      { name: "Messages sent", values: a.series.messages },
      { name: "Routine runs", values: a.series.routineRuns },
    ],
  };
}

const hasActivity = (a: BotActivity) =>
  [a.series.calls, a.series.messages, a.series.routineRuns].some((s) => s.some((n) => n > 0));

/** How much a bot works: routines, calls, tokens, messages and tasks, with one chart of the last 30 days. */
export function StatsSection({ bot }: SectionProps) {
  const q = useQuery(botStatsQueries.activity(bot.id));
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(q.error)}
      </p>
    );
  const a = q.data;
  const reported = a.tokens.reportedCalls > 0;
  return (
    <div className="space-y-6">
      {/* As many columns as fit (never a lone fifth figure on a second row at a width that has room for five). */}
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-6 gap-y-4">
        <Figure
          label="Routines"
          value={num(a.routines.active)}
          note={`${num(a.routines.paused)} paused`}
        />
        <Figure
          label="Calls"
          value={num(a.calls.last30)}
          note={`${num(a.calls.toolCalls)} tool calls`}
        />
        <Figure
          label="Tokens"
          value={reported ? compact(a.tokens.total) : "–"}
          note={reported ? `${compact(a.tokens.output)} output` : "not reported"}
        />
        <Figure
          label="Messages"
          value={num(a.messages.sent)}
          note={`${num(a.messages.received)} received`}
        />
        <Figure label="Open tasks" value={num(a.tasks.open)} note={`${num(a.tasks.done)} done`} />
      </dl>
      {hasActivity(a) ? (
        <ChartView fill title="Last 30 days, per day" chart={activityChart(a)} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No calls, messages or routine runs in the last 30 days.
        </p>
      )}
      <TokenUsage a={a} />
    </div>
  );
}

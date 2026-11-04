import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Badge } from "../shared/ui";
import { call } from "../chat/chat-client";
import { layoutTimeline, type TimelineRun } from "./timeline-layout";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatTime, type TimeFormat } from "@/features/preferences/time-format";

const HOUR = 3600_000;
const NO_RUNS: TimelineRun[] = [];
const WINDOWS = [3, 12, 24] as const;
const BAR: Record<TimelineRun["status"], string> = {
  running: "bg-primary animate-pulse",
  succeeded: "bg-success",
  failed: "bg-destructive",
  blocked: "bg-warn",
  skipped: "bg-muted-foreground/50",
  interrupted: "bg-warn",
};
const time = (iso: string, f: TimeFormat) => formatTime(iso, f);
const elapsed = (from: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

function ChatLink({ run }: { run: TimelineRun }) {
  return run.conversationId ? (
    <Link
      className="text-xs underline"
      to="/chat/{-$chatId}"
      params={{ chatId: run.conversationId }}
    >
      Open the chat
    </Link>
  ) : (
    <span className="text-xs text-muted-foreground">Chat not started yet</span>
  );
}

/** Live timeline of routine runs: running ones pulse up to now and link to their chat. Refreshes every few seconds. */
export function RoutineTimeline() {
  const tf = useTimeFormat();
  const [hours, setHours] = useState<(typeof WINDOWS)[number]>(3);
  // The window ends "now" when the request runs, so the key holds the window size only; `at` is that moment.
  const query = useQuery({
    queryKey: ["routines", "timeline", { hours }],
    queryFn: async () => {
      const at = Date.now();
      const r = await call<{ runs: TimelineRun[] }>("/api/routines/timeline", "POST", {
        from: new Date(at - hours * HOUR).toISOString(),
        to: new Date(at).toISOString(),
      });
      return { runs: r.runs, at };
    },
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });
  const runs = query.data?.runs ?? NO_RUNS;
  const [mountedAt] = useState(() => Date.now());
  const now = query.data?.at ?? mountedAt;
  const error = query.error ? "Could not load the timeline." : undefined;
  const to = now,
    from = now - hours * HOUR;
  const lanes = useMemo(() => layoutTimeline(runs, from, to, now), [runs, from, to, now]);
  const running = runs.filter((r) => r.status === "running");
  // Fewer labels on longer windows, and the first and last pinned to the edges so none spills out of the track.
  const step = hours <= 3 ? 1 : hours <= 12 ? 2 : 4;
  const ticks = Array.from({ length: Math.floor(hours / step) + 1 }, (_, i) => ({
    at: from + i * step * HOUR,
    pct: ((i * step) / hours) * 100,
  }));
  return (
    <section aria-label="Routine timeline" className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight">Timeline</h3>
        <div role="group" aria-label="Time window" className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={hours === w}
              onClick={() => setHours(w)}
              className={`rounded-md border px-2 py-0.5 text-xs ${hours === w ? "bg-primary text-primary-foreground" : ""}`}
            >
              Last {w}h
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div aria-live="polite">
        <h4 className="mb-1 text-sm font-medium">
          Running now <span className="tabular-nums text-muted-foreground">{running.length}</span>
        </h4>
        {running.length === 0 && (
          <p className="text-sm text-muted-foreground">No routine is running.</p>
        )}
        <ul className="space-y-1 text-sm">
          {running.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <Badge tone="success">Running</Badge>
              <span className="min-w-0 break-words font-medium">{r.title}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                since {time(r.startedAt, tf)} · {elapsed(r.startedAt, now)}
              </span>
              <ChatLink run={r} />
            </li>
          ))}
        </ul>
      </div>
      {lanes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs in the last {hours} hours.</p>
      ) : (
        <div className="space-y-1">
          <div
            className="relative ml-0 h-4 whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:ml-48"
            aria-hidden
          >
            {ticks.map((t, i) => (
              <span
                key={t.at}
                className={`absolute ${i === 0 ? "" : i === ticks.length - 1 && t.pct >= 99 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: `${t.pct}%` }}
              >
                {formatTime(t.at, tf)}
              </span>
            ))}
          </div>
          {lanes.map((lane) => (
            <div
              key={lane.routineId}
              className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-0"
            >
              <p className="truncate text-xs sm:w-48 sm:pr-2" title={lane.title}>
                {lane.title}
              </p>
              <div className="relative h-6 flex-1 rounded bg-muted/40">
                {lane.bars.map(({ run, left, width }) => {
                  const label = `${run.title}: ${run.status}, started ${time(run.startedAt, tf)}`;
                  const cls = `absolute top-1 h-4 rounded-sm ${BAR[run.status]}`;
                  const style = {
                    left: `${Math.min(left, 99.2)}%`,
                    width: `${Math.min(width, 100 - left)}%`,
                  };
                  return run.conversationId ? (
                    <Link
                      key={run.id}
                      to="/chat/{-$chatId}"
                      params={{ chatId: run.conversationId }}
                      className={cls}
                      style={style}
                      title={label}
                      aria-label={`${label}. Open the chat`}
                    />
                  ) : (
                    <span
                      key={run.id}
                      className={cls}
                      style={style}
                      title={label}
                      role="img"
                      aria-label={label}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

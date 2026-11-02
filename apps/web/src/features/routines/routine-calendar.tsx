import { useEffect, useMemo, useState } from "react";
import { Calendar } from "@g4rcez/components/calendar";

import { call } from "../chat/chat-client";
import { dayKey, groupByDay, monthRange, type CalendarItem } from "./calendar-days";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatTime } from "@/features/preferences/time-format";

const STATUS_LABEL: Record<string, string> = {
  succeeded: "ran",
  failed: "failed",
  blocked: "blocked",
  skipped: "skipped",
  interrupted: "interrupted",
  running: "running",
};

/** Month view of routine occurrences (upcoming and past) built with the shared @g4rcez/components Calendar. */
export function RoutineCalendar({ refreshKey }: { refreshKey: number }) {
  const tf = useTimeFormat();
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState<Date | undefined>(new Date());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const { from, to } = monthRange(month);
    let alive = true;
    call<{ items: CalendarItem[] }>("/api/routines/calendar", "POST", {
      from: from.toISOString(),
      to: to.toISOString(),
    })
      .then((r) => {
        if (alive) {
          setItems(r.items);
          setError(undefined);
        }
      })
      .catch(() => {
        if (alive) setError("Could not load the calendar.");
      });
    return () => {
      alive = false;
    };
  }, [month, refreshKey]);
  const byDay = useMemo(() => groupByDay(items), [items]);
  const todays = selected ? (byDay.get(dayKey(selected)) ?? []) : [];
  return (
    <section aria-label="Routine calendar" className="space-y-4 rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold tracking-tight">Calendar</h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Calendar
          date={selected ?? month}
          onChange={(d: Date | undefined) => {
            if (d) {
              setSelected(d);
              if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear())
                setMonth(d);
            }
          }}
          onChangeMonth={(d: Date) => setMonth(d)}
          onChangeYear={(d: Date) => setMonth(d)}
          RenderOnDay={({ date }: { date: Date }) => {
            const n = byDay.get(dayKey(date))?.length ?? 0;
            return n ? (
              <span aria-label={`${n} routine events`} className="block text-xs leading-none">
                ● {n}
              </span>
            ) : null;
          }}
        />
        <div aria-live="polite">
          <h4 className="mb-2 text-sm font-medium">
            {selected
              ? selected.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "Pick a day"}
          </h4>
          {todays.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing scheduled or run on this day.</p>
          )}
          <ul className="space-y-1 text-sm">
            {todays.map((i, k) => (
              <li key={`${i.routineId}-${i.at}-${k}`} className="flex gap-2">
                <time dateTime={i.at} className="tabular-nums text-muted-foreground">
                  {formatTime(i.at, tf)}
                </time>
                <span>{i.title}</span>
                <span className="text-muted-foreground">
                  {i.kind === "scheduled"
                    ? "scheduled"
                    : (STATUS_LABEL[i.status ?? ""] ?? i.status)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

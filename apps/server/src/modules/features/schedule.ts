/**
 * Schedule policy (documented in docs/operations/schedules.md):
 * - A daily routine runs when the wall clock in its IANA timezone reads HH:MM.
 * - DST gap (that wall time does not exist that day): the occurrence for that day is skipped; the next day runs normally.
 * - DST fold (that wall time happens twice): it runs at the first occurrence only.
 * - Interval routines run every N minutes of real time (no DST effect).
 * - After downtime only one catch-up run happens; missed occurrences are not replayed.
 */
const FMT = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => {
  let f = FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    FMT.set(tz, f);
  }
  return f;
};
const hm = (t: Date, tz: string) => {
  const p = fmt(tz).formatToParts(t);
  return [
    Number(p.find((x) => x.type === "hour")?.value),
    Number(p.find((x) => x.type === "minute")?.value),
  ] as const;
};

const DAY = new Map<string, Intl.DateTimeFormat>();
const day = (t: Date, tz: string) => {
  let f = DAY.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    DAY.set(tz, f);
  }
  return f.format(t);
};

const WEEKDAY_FMT = new Map<string, Intl.DateTimeFormat>();
const DAY_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
/** Day of the week (0 = Sunday … 6 = Saturday) of the instant on the wall clock of `tz`. */
const weekdayOf = (t: Date, tz: string) => {
  let f = WEEKDAY_FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    WEEKDAY_FMT.set(tz, f);
  }
  return DAY_NUMBER[f.format(t)] ?? 0;
};
/** The days a daily routine may run on, or null for every day (a missing, empty or full list all mean every day). */
const allowedDays = (weekdays?: readonly number[] | null) => {
  const set = new Set((weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  return set.size === 0 || set.size === 7 ? null : set;
};

/** The list as it is stored: sorted, without duplicates or bad values; null when it means every day. */
export const normalizeWeekdays = (weekdays?: readonly number[] | null): number[] | null => {
  const allowed = allowedDays(weekdays);
  return allowed ? [...allowed].sort((a, b) => a - b) : null;
};

/** Next instant strictly after `after` at which the wall clock in `timezone` reads `HH:MM` (first one in a fold; none in a gap), on one of `weekdays` (0 = Sunday) when given. */
export function nextDailyRun(
  after: Date,
  timezone: string,
  dailyAt: string,
  weekdays?: readonly number[] | null,
): Date {
  const [h, m] = dailyAt.split(":").map(Number);
  const allowed = allowedDays(weekdays);
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  // If `after` itself is an occurrence (it reads exactly HH:MM), that local day is done: a DST fold must not run it twice.
  const [ah, am] = hm(after, timezone);
  const doneDay = ah === h && am === m ? day(after, timezone) : undefined;
  // Two days are enough for "every day"; a weekday restriction can skip up to six, so look eight days (a day lost to a DST gap included) ahead.
  const horizon = allowed ? 8 * 24 * 60 : 49 * 60;
  for (let i = 0; i < horizon; i++) {
    const t = new Date(start + i * 60_000);
    const [hh, mm] = hm(t, timezone);
    if (
      hh === h &&
      mm === m &&
      day(t, timezone) !== doneDay &&
      (!allowed || allowed.has(weekdayOf(t, timezone)))
    )
      return t;
  }
  throw new Error("no_next_run");
}

export type Recurrence = {
  timezone: string;
  dailyAt: string | null;
  everyMinutes: number | null;
  /** Days a daily routine runs on (0 = Sunday … 6 = Saturday). Null or empty = every day. Ignored by interval and one-time routines. */
  weekdays?: readonly number[] | null;
  kind?: "recurring" | "once";
  onceAt?: Date | null;
};
export function computeNextRun(now: Date, r: Recurrence): Date | null {
  if (r.kind === "once") return r.onceAt && r.onceAt > now ? r.onceAt : null;
  if (r.dailyAt) return nextDailyRun(now, r.timezone, r.dailyAt, r.weekdays);
  return new Date(now.getTime() + (r.everyMinutes ?? 60) * 60_000);
}
/** Next `count` occurrences (preview shown before activation). */
export function previewRuns(now: Date, r: Recurrence, count = 3): Date[] {
  const out: Date[] = [];
  let cursor = now;
  for (let i = 0; i < count; i++) {
    const n = computeNextRun(cursor, r);
    if (!n) break;
    out.push(n);
    cursor = n;
  }
  return out;
}
export function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "every day", "weekdays", "weekends", "Mondays" or "Mon, Wed, Fri": the days part of a daily schedule. */
export function describeDays(weekdays?: readonly number[] | null) {
  const allowed = allowedDays(weekdays);
  if (!allowed) return "every day";
  const days = [...allowed].sort((a, b) => a - b);
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "weekdays";
  if (key === "0,6") return "weekends";
  if (days.length === 1) return `${DAY_NAME[days[0]!]}s`;
  return days.map((d) => DAY_NAME[d]!.slice(0, 3)).join(", ");
}
export function describeSchedule(r: Recurrence) {
  if (r.kind === "once") return r.onceAt ? `once at ${r.onceAt.toISOString()}` : "once";
  return r.dailyAt
    ? `${describeDays(r.weekdays)} at ${r.dailyAt} (${r.timezone})`
    : `every ${r.everyMinutes} minutes`;
}

/**
 * Schedule policy (documented in docs/operations/schedules.md):
 * - A daily routine runs when the wall clock in its IANA timezone reads HH:MM.
 * - DST gap (that wall time does not exist that day): the occurrence for that day is skipped; the next day runs normally.
 * - DST fold (that wall time happens twice): it runs at the first occurrence only.
 * - Interval routines run every N minutes of real time (no DST effect).
 * - After downtime only one catch-up run happens; missed occurrences are not replayed.
 */
const FMT = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => { let f = FMT.get(tz); if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); FMT.set(tz, f); } return f; };
const hm = (t: Date, tz: string) => { const p = fmt(tz).formatToParts(t); return [Number(p.find((x) => x.type === "hour")?.value), Number(p.find((x) => x.type === "minute")?.value)] as const; };

const DAY = new Map<string, Intl.DateTimeFormat>();
const day = (t: Date, tz: string) => { let f = DAY.get(tz); if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); DAY.set(tz, f); } return f.format(t); };

/** Next instant strictly after `after` at which the wall clock in `timezone` reads `HH:MM` (first one in a fold; none in a gap). */
export function nextDailyRun(after: Date, timezone: string, dailyAt: string): Date {
  const [h, m] = dailyAt.split(":").map(Number);
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  // If `after` itself is an occurrence (it reads exactly HH:MM), that local day is done: a DST fold must not run it twice.
  const [ah, am] = hm(after, timezone);
  const doneDay = ah === h && am === m ? day(after, timezone) : undefined;
  for (let i = 0; i < 49 * 60; i++) {
    const t = new Date(start + i * 60_000);
    const [hh, mm] = hm(t, timezone);
    if (hh === h && mm === m && day(t, timezone) !== doneDay) return t;
  }
  throw new Error("no_next_run");
}

export type Recurrence = { timezone: string; dailyAt: string | null; everyMinutes: number | null; kind?: "recurring" | "once"; onceAt?: Date | null };
export function computeNextRun(now: Date, r: Recurrence): Date | null {
  if (r.kind === "once") return r.onceAt && r.onceAt > now ? r.onceAt : null;
  if (r.dailyAt) return nextDailyRun(now, r.timezone, r.dailyAt);
  return new Date(now.getTime() + (r.everyMinutes ?? 60) * 60_000);
}
/** Next `count` occurrences (preview shown before activation). */
export function previewRuns(now: Date, r: Recurrence, count = 3): Date[] {
  const out: Date[] = []; let cursor = now;
  for (let i = 0; i < count; i++) { const n = computeNextRun(cursor, r); if (!n) break; out.push(n); cursor = n; }
  return out;
}
export function validTimezone(tz: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}
export function describeSchedule(r: Recurrence) {
  if (r.kind === "once") return r.onceAt ? `once at ${r.onceAt.toISOString()}` : "once";
  return r.dailyAt ? `every day at ${r.dailyAt} (${r.timezone})` : `every ${r.everyMinutes} minutes`;
}

/**
 * Time counted the way a manager counts it: Saturday and Sunday do not exist. Work that sat untouched from Friday evening to Monday
 * morning was not idle for two days. The day of the week is read in `timeZone` (an IANA name); an unknown name falls back to UTC.
 */

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

function weekdayIn(timeZone: string): (at: number) => string {
  try {
    const format = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });
    return (at) => format.format(at);
  } catch {
    const format = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
    return (at) => format.format(at);
  }
}

/** Milliseconds between two moments that fall on Monday to Friday. Counted hour by hour, which is exact enough for thresholds of hours and days. */
export function workingMsBetween(from: Date, to: Date, timeZone = "UTC"): number {
  const start = +from,
    end = +to;
  if (!(end > start)) return 0;
  // A year of hours is the most this walks; anything older is "a long time" for every caller.
  const first = Math.max(start, end - 366 * DAY_MS);
  const weekday = weekdayIn(timeZone);
  let total = 0;
  for (let at = first; at < end; at += HOUR_MS) {
    const day = weekday(at);
    if (day !== "Sat" && day !== "Sun") total += Math.min(HOUR_MS, end - at);
  }
  return total;
}

/** Whole working days between two moments (24 working hours each). */
export const workingDaysBetween = (from: Date, to: Date, timeZone = "UTC"): number =>
  Math.floor(workingMsBetween(from, to, timeZone) / DAY_MS);

/** The moment `ms` working milliseconds after `from`: "a working day from Friday 15:00" is Monday 15:00. */
export function addWorkingMs(from: Date, ms: number, timeZone = "UTC"): Date {
  const weekday = weekdayIn(timeZone);
  let at = +from;
  let left = Math.max(0, ms);
  // Never walks more than a year of hours: a wait that long is not a wait.
  for (let i = 0; left > 0 && i < 366 * 24; i++) {
    const day = weekday(at);
    const step = Math.min(HOUR_MS, left);
    if (day !== "Sat" && day !== "Sun") left -= step;
    at += day === "Sat" || day === "Sun" ? HOUR_MS : step;
  }
  return new Date(at);
}

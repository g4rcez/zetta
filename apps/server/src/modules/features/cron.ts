import { normalizeWeekdays } from "./schedule";

/**
 * Cron expressions as Zetta can run them: one time a day (on some weekdays or all), or every N minutes. Anything else (several times a
 * day, a day of the month, an hour step...) is `unsupported`. Shared by the routine schedule text and the Grok Bot importer.
 */
export type CronSchedule =
  | { kind: "daily"; dailyAt: string; weekdays: number[] | null }
  | { kind: "interval"; everyMinutes: number }
  | { kind: "unsupported"; expression: string | null };

/** Zetta's shortest interval (the routine API refuses anything below it). */
export const MIN_INTERVAL = 5;
const DAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** One cron weekday as 0-7 (7 is a second spelling of Sunday), or null when it is not a plain day. */
function rawDay(token: string): number | null {
  const name = DAY_NAMES[token.toLowerCase()];
  if (name !== undefined) return name;
  return /^[0-7]$/.test(token) ? Number(token) : null;
}

/** The weekday field: `*`, a list, a range, day names. Null days = every day; `undefined` = not something Zetta can run. */
function parseDays(field: string): { days: number[] | null } | undefined {
  if (field === "*") return { days: null };
  const days: number[] = [];
  for (const part of field.split(",")) {
    const [from, to, ...rest] = part.split("-");
    if (from === undefined || rest.length > 0) return undefined;
    const lo = rawDay(from);
    const hi = to === undefined ? lo : rawDay(to);
    if (lo === null || hi === null || lo > hi) return undefined;
    for (let d = lo; d <= hi; d++) days.push(d % 7);
  }
  return { days: normalizeWeekdays(days) };
}

export const pad = (n: number) => String(n).padStart(2, "0");

/** Translates one five-field cron expression. The time is read in the routine's own timezone; the caller attaches it. */
export function scheduleFromCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  const unsupported: CronSchedule = { kind: "unsupported", expression: fields.join(" ") };
  if (fields.length !== 5) return unsupported;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (dayOfMonth !== "*" || month !== "*") return unsupported;

  const step = /^\*\/(\d{1,2})$/.exec(minute);
  if (step && hour === "*" && dayOfWeek === "*") {
    const everyMinutes = Number(step[1]);
    return everyMinutes >= MIN_INTERVAL ? { kind: "interval", everyMinutes } : unsupported;
  }

  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return unsupported;
  const [m, h] = [Number(minute), Number(hour)];
  if (m > 59 || h > 23) return unsupported;
  const days = parseDays(dayOfWeek);
  if (!days) return unsupported;
  return { kind: "daily", dailyAt: `${pad(h)}:${pad(m)}`, weekdays: days.days };
}

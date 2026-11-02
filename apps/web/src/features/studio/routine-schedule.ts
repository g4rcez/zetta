/** Pure helpers for routine schedules (form values -> API payload). */
import { formatDateTime, formatTime, type TimeFormat } from "@/features/preferences/time-format";

export type ScheduleMode = "daily" | "interval" | "once";
export type ScheduleInput = {
  mode: ScheduleMode;
  timezone: string;
  dailyAt: string;
  everyMinutes: string;
  onceLocal: string;
};
export type SchedulePayload = {
  timezone: string;
  dailyAt?: string;
  everyMinutes?: number;
  onceAt?: string;
};

/** Returns the payload, or a plain-language problem. `onceLocal` is a datetime-local string, converted to an ISO instant. */
export function buildSchedule(
  i: ScheduleInput,
): { ok: true; value: SchedulePayload } | { ok: false; problem: string } {
  const timezone = i.timezone.trim();
  if (!timezone) return { ok: false, problem: "Enter a timezone, for example Europe/Lisbon." };
  if (i.mode === "daily")
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(i.dailyAt)
      ? { ok: true, value: { timezone, dailyAt: i.dailyAt } }
      : { ok: false, problem: "Choose the time of day." };
  if (i.mode === "interval") {
    const n = Number(i.everyMinutes);
    return Number.isInteger(n) && n >= 5 && n <= 10080
      ? { ok: true, value: { timezone, everyMinutes: n } }
      : { ok: false, problem: "Choose a number of minutes between 5 and 10080." };
  }
  const when = new Date(i.onceLocal);
  if (!i.onceLocal || Number.isNaN(when.getTime()))
    return { ok: false, problem: "Choose the date and time." };
  return { ok: true, value: { timezone, onceAt: when.toISOString() } };
}

/** "08:00" as the person reads hours; 24h keeps the stored text. */
const clock = (hhmm: string, f: TimeFormat) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return f === "24h" ? hhmm : formatTime(new Date(2000, 0, 1, h, m), f);
};

export function describeSchedule(
  r: {
    kind?: string;
    dailyAt: string | null;
    everyMinutes: number | null;
    onceAt?: string | null;
    timezone: string;
  },
  f: TimeFormat = "24h",
): string {
  if (r.kind === "once" || r.onceAt)
    return `once on ${r.onceAt ? formatDateTime(r.onceAt, f) : "a set date"}`;
  if (r.dailyAt) return `every day at ${clock(r.dailyAt, f)} (${r.timezone})`;
  if (r.everyMinutes)
    return r.everyMinutes % 60 === 0
      ? `every ${r.everyMinutes / 60} hour(s)`
      : `every ${r.everyMinutes} minutes`;
  return "no schedule";
}

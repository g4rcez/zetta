/** Pure helpers for routine schedules (form values -> API payload). */
import { formatDateTime, formatTime, type TimeFormat } from "@/features/preferences/time-format";

/** `text`: the schedule written in words or as a cron ("Monday to Friday at 8:30"), read by the server. */
export type ScheduleMode = "text" | "daily" | "interval" | "once";
export type ScheduleInput = {
  mode: ScheduleMode;
  timezone: string;
  dailyAt: string;
  everyMinutes: string;
  onceLocal: string;
  /** The words, for `text` mode. */
  text?: string;
};
export type SchedulePayload = {
  timezone: string;
  dailyAt?: string;
  everyMinutes?: number;
  onceAt?: string;
  /** The schedule as typed; the server reads it into the fields above. */
  when?: string;
};

/** Returns the payload, or a plain-language problem. `onceLocal` is a datetime-local string, converted to an ISO instant. */
export function buildSchedule(
  i: ScheduleInput,
): { ok: true; value: SchedulePayload } | { ok: false; problem: string } {
  const timezone = i.timezone.trim();
  if (!timezone) return { ok: false, problem: "Enter a timezone, for example Europe/Lisbon." };
  if (i.mode === "text") {
    const when = (i.text ?? "").trim();
    return when
      ? { ok: true, value: { timezone, when } }
      : { ok: false, problem: 'Write when it should run, for example "Monday to Friday at 8:30".' };
  }
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

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The days of a daily routine in words: "every day", "weekdays", "weekends", "Mondays" or "Mon, Wed, Fri". */
export function describeDays(weekdays?: readonly number[] | null): string {
  const days = [...new Set((weekdays ?? []).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return "every day";
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "weekdays";
  if (key === "0,6") return "weekends";
  if (days.length === 1) return `${DAYS[days[0]!]}s`;
  return days.map((d) => DAYS[d]!.slice(0, 3)).join(", ");
}

const interval = (minutes: number) =>
  minutes === 60
    ? "every hour"
    : minutes % 60 === 0
      ? `every ${minutes / 60} hours`
      : `every ${minutes} minutes`;

type Described = {
  kind?: string;
  dailyAt: string | null;
  everyMinutes: number | null;
  weekdays?: number[] | null;
  onceAt?: string | null;
  timezone: string;
};

export function describeSchedule(r: Described, f: TimeFormat = "24h"): string {
  if (r.kind === "once" || r.onceAt)
    return `once on ${r.onceAt ? formatDateTime(r.onceAt, f) : "a set date"}`;
  if (r.dailyAt) return `${describeDays(r.weekdays)} at ${clock(r.dailyAt, f)} (${r.timezone})`;
  if (r.everyMinutes) return interval(r.everyMinutes);
  return "no schedule";
}

/**
 * The schedule as text the server reads back to the same schedule: what the edit form starts its "describe it" box from. 24 hour time, no
 * timezone (that is its own field). A one-time routine has none: its date cannot be changed.
 */
export function scheduleText(r: Omit<Described, "timezone"> & { timezone?: string }): string {
  if (r.kind === "once" || r.onceAt) return "";
  if (r.dailyAt) return `${describeDays(r.weekdays)} at ${r.dailyAt}`;
  return r.everyMinutes ? interval(r.everyMinutes) : "";
}

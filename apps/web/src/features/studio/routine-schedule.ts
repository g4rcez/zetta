/** Pure helpers for routine schedules (form values -> API payload). */
export type ScheduleMode = "daily" | "interval" | "once";
export type ScheduleInput = { mode: ScheduleMode; timezone: string; dailyAt: string; everyMinutes: string; onceLocal: string };
export type SchedulePayload = { timezone: string; dailyAt?: string; everyMinutes?: number; onceAt?: string };

/** Returns the payload, or a plain-language problem. `onceLocal` is a datetime-local string, converted to an ISO instant. */
export function buildSchedule(i: ScheduleInput): { ok: true; value: SchedulePayload } | { ok: false; problem: string } {
  const timezone = i.timezone.trim();
  if (!timezone) return { ok: false, problem: "Enter a timezone, for example Europe/Lisbon." };
  if (i.mode === "daily") return /^([01]\d|2[0-3]):[0-5]\d$/.test(i.dailyAt) ? { ok: true, value: { timezone, dailyAt: i.dailyAt } } : { ok: false, problem: "Choose the time of day." };
  if (i.mode === "interval") {
    const n = Number(i.everyMinutes);
    return Number.isInteger(n) && n >= 5 && n <= 10080 ? { ok: true, value: { timezone, everyMinutes: n } } : { ok: false, problem: "Choose a number of minutes between 5 and 10080." };
  }
  const when = new Date(i.onceLocal);
  if (!i.onceLocal || Number.isNaN(when.getTime())) return { ok: false, problem: "Choose the date and time." };
  return { ok: true, value: { timezone, onceAt: when.toISOString() } };
}

export function describeSchedule(r: { kind?: string; dailyAt: string | null; everyMinutes: number | null; onceAt?: string | null; timezone: string }): string {
  if (r.kind === "once" || r.onceAt) return `once on ${r.onceAt ? new Date(r.onceAt).toLocaleString() : "a set date"}`;
  if (r.dailyAt) return `every day at ${r.dailyAt} (${r.timezone})`;
  if (r.everyMinutes) return r.everyMinutes % 60 === 0 ? `every ${r.everyMinutes / 60} hour(s)` : `every ${r.everyMinutes} minutes`;
  return "no schedule";
}

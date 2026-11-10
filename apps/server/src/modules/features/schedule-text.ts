import * as chrono from "chrono-node";

import { MIN_INTERVAL, pad, scheduleFromCron } from "./cron";
import { describeSchedule, normalizeWeekdays, validTimezone } from "./schedule";

/**
 * Reads a schedule a person typed: "Monday to Friday at 8:30", "every 15 minutes", "tomorrow at 5pm" or a cron such as `0 9 * * 1-5`.
 * The answer is the same fields a routine stores (`dailyAt`, `weekdays`, `everyMinutes`, `onceAt`), so a form, the API and Chief all
 * end in one place and the person sees what was understood before anything runs.
 *
 * Who reads what: cron, intervals and the days ("Monday to Friday", lists, weekdays, weekends) are read here, because a date library
 * does not know recurrence (chrono-node reads "Monday to Friday at 8:30" as one range of dates). chrono-node reads the one-time
 * dates ("next Friday at 9:30", "December 12 at noon", "in 2 hours") in the routine's own timezone.
 */
export type ScheduleText = {
  dailyAt?: string;
  weekdays?: number[];
  everyMinutes?: number;
  onceAt?: string;
};
export type ScheduleTextResult =
  | {
      ok: true;
      schedule: ScheduleText;
      /** The schedule in words, as the routine list shows it, so the person can check it. */
      understood: string;
      /** What was filled in because the text did not say it ("morning" read as 08:00), or null. */
      assumed: string | null;
    }
  | { ok: false; problem: string };

const MAX_LENGTH = 200;
const MAX_INTERVAL = 10_080;
const EXAMPLES = `Try "Monday to Friday at 8:30", "every 15 minutes", "tomorrow at 5pm" or a cron such as 0 9 * * 1-5.`;
/** The clock time a part of the day stands for, when the text says "every morning" and no time. */
const TIME_OF_DAY: Record<string, string> = {
  morning: "08:00",
  midday: "12:00",
  afternoon: "15:00",
  evening: "18:00",
  night: "21:00",
};

const fail = (problem: string): ScheduleTextResult => ({ ok: false, problem });

const DAY =
  "(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)";
const DAY_ONE = new RegExp(`\\b(${DAY})(s?)\\b`, "g");
const DAY_RANGE = new RegExp(
  `\\b${DAY}s?\\s*(?:to|until|till|through|thru|-|–|—)\\s*${DAY}s?\\b`,
  "g",
);
const DAY_NUMBER: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const dayOf = (name: string) => DAY_NUMBER[name.slice(0, 3)]!;
const WEEK = [1, 2, 3, 4, 5];

/** The days a range covers, going forward and wrapping past Sunday ("Friday to Monday" is Fri, Sat, Sun, Mon). */
function expandRange(from: number, to: number): number[] {
  const days = [from];
  for (let d = from; d !== to;) {
    d = (d + 1) % 7;
    days.push(d);
  }
  return days;
}

type Days = { days: Set<number>; ranged: boolean; plural: boolean; words: boolean };
/** Every day the text names: ranges, a list, single names (plural too), `weekdays` and `weekends`. */
function readDays(w: string): Days {
  const days = new Set<number>();
  let ranged = false;
  let plural = false;
  const rest = w.replace(DAY_RANGE, (hit) => {
    const [a, b] = [...hit.matchAll(new RegExp(DAY, "g"))].map((m) => dayOf(m[0]));
    for (const d of expandRange(a!, b!)) days.add(d);
    ranged = true;
    return " ";
  });
  for (const m of rest.matchAll(DAY_ONE)) {
    days.add(dayOf(m[1]!));
    // "Mondays", "fridays": a plural names a weekly habit, not one date.
    if (m[2] === "s") plural = true;
  }
  let words = false;
  if (/\bweekdays?\b/.test(w)) {
    for (const d of WEEK) days.add(d);
    words = true;
  }
  if (/\bweekends?\b/.test(w)) {
    days.add(0);
    days.add(6);
    words = true;
  }
  return { days, ranged, plural, words };
}

/** A clock time in the text as HH:MM, `null` when there is none, `"invalid"` when it names an hour or minute that does not exist. */
function readTime(w: string): string | null | "invalid" {
  const text = w.replace(/\b([ap])\.m\./g, "$1m");
  if (/\b(?:at )?noon\b/.test(text)) return "12:00";
  if (/\b(?:at )?midnight\b/.test(text)) return "00:00";
  const clock =
    /\b(?:at )?(\d{1,2})h(\d{2})?\b()/.exec(text) ??
    /\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(text) ??
    /\b(?:at )?(\d{1,2}):(\d{2})()\b/.exec(text) ??
    /\bat (\d{1,2})(?![\d:])()()/.exec(text);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2] || 0);
  if (clock[3]) {
    if (hour < 1 || hour > 12) return "invalid";
    hour = (hour % 12) + (clock[3] === "pm" ? 12 : 0);
  }
  return hour > 23 || minute > 59 ? "invalid" : `${pad(hour)}:${pad(minute)}`;
}

/** The wall clock of `tz` minus UTC at `at`, in minutes (-180 for São Paulo). */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant at which the wall clock of `tz` reads this date and time. The offset is looked up twice, so a daylight-saving change between now and then is honoured. */
function wallToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - offsetMinutes(new Date(asUtc), tz) * 60_000;
  return new Date(asUtc - offsetMinutes(new Date(first), tz) * 60_000);
}

/** The instant in words, in the routine's timezone: "once on 10 Nov 2026 at 17:00 (America/Sao_Paulo)". */
function describeOnce(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `once on ${get("day")} ${get("month")} ${get("year")} at ${get("hour")}:${get("minute")} (${timezone})`;
}

export function parseScheduleText(
  raw: string,
  { timezone, now = new Date() }: { timezone: string; now?: Date },
): ScheduleTextResult {
  if (!validTimezone(timezone))
    return fail(`"${timezone}" is not a timezone (for example Europe/Lisbon).`);
  const text = raw.trim();
  if (!text) return fail('Say when it should run, for example "Monday to Friday at 8:30".');
  if (text.length > MAX_LENGTH) return fail(`That is too long. ${EXAMPLES}`);
  // The app writes a routine's timezone in brackets; it is not part of the schedule.
  const plain = text
    .replace(/\([^)]*\)/g, " ")
    .replace(/@/g, " at ")
    .replace(/\s+/g, " ")
    .trim();
  const w = plain.toLowerCase().replace(/[,.;!]+(?=\s|$)/g, "");

  // ── cron
  const tokens = plain.replace(/^cron\s+/i, "").split(" ");
  if (
    tokens.length === 5 &&
    /^[0-9*]/.test(tokens[0]!) &&
    tokens.every((t) => /^[0-9*/,a-z-]+$/i.test(t)) &&
    tokens.slice(0, 4).every((t) => /^[0-9*/,-]+$/.test(t))
  ) {
    const cron = scheduleFromCron(tokens.join(" "));
    if (cron.kind === "unsupported")
      return fail(
        `That cron (${cron.expression}) can't run in Zetta yet. A routine runs one time a day (on the days you choose) or every few minutes.`,
      );
    const schedule: ScheduleText =
      cron.kind === "interval"
        ? { everyMinutes: cron.everyMinutes }
        : { dailyAt: cron.dailyAt, ...(cron.weekdays ? { weekdays: cron.weekdays } : {}) };
    return done(schedule, timezone, null);
  }

  // ── a cadence Zetta has no field for
  if (
    /\b(monthly|quarterly|yearly|annually|every month|each month)\b/.test(w) ||
    /\b(?:first|last|\d{1,2}(?:st|nd|rd|th)) of (?:each|every|the) (?:month|quarter|year)\b/.test(w)
  )
    return fail(
      "Monthly schedules are not supported yet. A routine runs every day, on the days you choose, or every few minutes.",
    );

  // ── every N minutes or hours
  const every = /\bevery (\d{1,4}) ?(minutes?|mins?|hours?|hrs?)\b/.exec(w);
  const minutes = every
    ? Number(every[1]) * (every[2]!.startsWith("h") ? 60 : 1)
    : /\b(?:every hour|hourly|each hour)\b/.test(w)
      ? 60
      : null;
  if (minutes !== null)
    return minutes >= MIN_INTERVAL && minutes <= MAX_INTERVAL
      ? done({ everyMinutes: minutes }, timezone, null)
      : fail(
          `An interval runs from every ${MIN_INTERVAL} minutes up to every 7 days (${MAX_INTERVAL} minutes).`,
        );

  // ── what the text says about days, times and one-time dates
  const { days, ranged, plural, words } = readDays(w);
  const time = readTime(w);
  if (time === "invalid")
    return fail(
      "That time of day does not exist. Use hours 0 to 23 and minutes 0 to 59, for example 8:30 or 6pm.",
    );
  const everyDay =
    /\b(?:daily|every ?day|each day|nightly|(?:every|each) (?:morning|afternoon|evening|night))\b/.test(
      w,
    );
  const cadence = /\b(?:every|each)\b/.test(w) || everyDay;
  const relative =
    /\b(?:tomorrow|today|tonight|yesterday|in \d+|from now|next|this|coming|upcoming)\b/.test(w);
  // chrono-node does not know IANA names ("Europe/Lisbon"), only offsets, so it is given the zone's offset now and the date it finds is
  // read again on the zone's own clock below (the offset can differ on that date).
  const found = chrono.parse(
    plain,
    { instant: now, timezone: offsetMinutes(now, timezone) },
    { forwardDate: true },
  );
  const dated = found.some((r) => r.start.isCertain("month") || r.start.isCertain("day"));

  const recurring =
    cadence ||
    words ||
    ranged ||
    plural ||
    days.size >= 2 ||
    (days.size === 1 && !relative && !dated) ||
    (days.size === 0 && time !== null && !relative && !dated);
  if (recurring) {
    if (!cadence && !words && !ranged && days.size === 0 && time === null)
      return fail(`I couldn't read "${text}" as a schedule. ${EXAMPLES}`);
    let dailyAt = time;
    let assumed: string | null = null;
    if (!dailyAt) {
      // A chrono-node reading of the same text is the last place a time may be hiding ("half past eight" style phrases).
      const certain = found.flatMap((r) => [r.start, r.end]).find((c) => c?.isCertain("hour"));
      if (certain) dailyAt = `${pad(certain.get("hour")!)}:${pad(certain.get("minute") ?? 0)}`;
    }
    if (!dailyAt) {
      const part = /\b(morning|afternoon|evening|night|midday)\b/.exec(w)?.[1];
      if (!part) return fail('Add a time of day, for example "Monday to Friday at 8:30".');
      dailyAt = TIME_OF_DAY[part]!;
      assumed = `"${part}" has no exact time, so it is set to ${dailyAt}. Say a time ("at 7:30") to choose another.`;
    }
    const weekdays = normalizeWeekdays([...days]);
    return done({ dailyAt, ...(weekdays ? { weekdays } : {}) }, timezone, assumed);
  }

  // ── one time, read by chrono-node
  const hit = found[0];
  if (!hit) return fail(`I couldn't read "${text}" as a schedule. ${EXAMPLES}`);
  if (!hit.start.isCertain("hour")) return fail(`Add a time, for example "${hit.text} at 5pm".`);
  const c = hit.start;
  const at = wallToInstant(
    c.get("year")!,
    c.get("month")!,
    c.get("day")!,
    c.get("hour")!,
    c.get("minute") ?? 0,
    timezone,
  );
  if (at.getTime() <= now.getTime())
    return fail("That moment has already passed. Choose one in the future.");
  return done({ onceAt: at.toISOString() }, timezone, null);
}

function done(
  schedule: ScheduleText,
  timezone: string,
  assumed: string | null,
): ScheduleTextResult {
  const understood = schedule.onceAt
    ? describeOnce(new Date(schedule.onceAt), timezone)
    : describeSchedule({
        timezone,
        dailyAt: schedule.dailyAt ?? null,
        weekdays: schedule.weekdays ?? null,
        everyMinutes: schedule.everyMinutes ?? null,
      });
  return { ok: true, schedule, understood, assumed };
}

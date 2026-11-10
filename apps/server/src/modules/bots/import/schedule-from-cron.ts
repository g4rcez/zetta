import { MIN_INTERVAL, pad, scheduleFromCron } from "../../features/cron";
import { describeDays, normalizeWeekdays } from "../../features/schedule";

export { scheduleFromCron };

/**
 * A Grok Bot routine says when it runs in its summary. A few carry a cron expression ("Cron 44 8 * * 1-5 (weekdays 8:44 local). ..."),
 * but most describe the cadence in plain English ("Every weekday morning, ...", "Every Friday evening, ...", "Once a week, ..."), with no
 * clock time. Zetta routines take a daily time (optionally on some weekdays) or a minute interval, so only those shapes translate.
 * Anything else (several times a day, a day of the month, an hour step...) is `unsupported`: the importer then keeps the routine paused
 * and says why.
 *
 * Words are turned into a time with fixed, documented defaults (`TIME_OF_DAY`), and a daily schedule built that way carries `assumed`, a
 * sentence saying what was filled in, so the review shows it and the person can change it before anything runs.
 */
export type GrokSchedule =
  | {
      kind: "daily";
      dailyAt: string;
      weekdays: number[] | null;
      /** What was filled in because the listing did not say it ("morning" read as 08:00). Absent for a cron or an explicit time. */
      assumed?: string;
    }
  | { kind: "interval"; everyMinutes: number }
  | { kind: "unsupported"; expression: string | null };

/** The schedule in words for a person, without a timezone (the person's own is used when it is installed): "weekdays at 08:44". */
export function describeGrokSchedule(s: GrokSchedule): string {
  if (s.kind === "interval") return `every ${s.everyMinutes} minutes`;
  if (s.kind === "daily")
    return `${describeDays(s.weekdays)} at ${s.dailyAt}${s.assumed ? " (assumed)" : ""}`;
  return s.expression
    ? `a schedule Zetta can't run yet (${s.expression})`
    : "no schedule we could read";
}

/** The clock time a word stands for, when a listing says "every morning" and nothing else. */
const TIME_OF_DAY: Record<string, string> = {
  morning: "08:00",
  noon: "12:00",
  midday: "12:00",
  afternoon: "15:00",
  evening: "18:00",
  night: "21:00",
};
/** The time of a daily routine that names neither a time nor a part of the day. */
const DEFAULT_TIME = "09:00";
/** The day of a weekly routine that says "once a week" and no day. */
const DEFAULT_WEEKDAY = 1;
const NAMED_DAYS = [
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
] as const;

/** A sentence that only says the routine is off ("Disabled by default.", "Paused."): the cadence is in what follows. */
const OFF_FLAG = /^(?:paused|disabled|off)(?: by default)?\s*[.:—-]\s*/i;

/** The first clause of a summary, which is where a listing puts its cadence ("Every Friday evening, the weekend and ..."). */
const firstClause = (summary: string) => {
  let text = summary.trim();
  for (let flag = OFF_FLAG.exec(text); flag; flag = OFF_FLAG.exec(text))
    text = text.slice(flag[0].length);
  return text.split(/[,.;—\n]|:\s/)[0]!.trim();
};

/**
 * An explicit time as HH:MM, or null when the clause has none: "at 7:30am", "at 6 pm", "at 14:15", "at noon", and, as listings often
 * write it with no "at", "Daily 8:25am", "weekday 6:45 pm", "every day 17:05".
 */
function explicitTime(words: string): string | null {
  if (/\bat noon\b/.test(words)) return "12:00";
  if (/\bat midnight\b/.test(words)) return "00:00";
  const clock =
    /\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(words) ??
    /\b(?:at )?([01]?\d|2[0-3]):([0-5]\d)()\b/.exec(words) ??
    /\bat (\d{1,2})()()\b/.exec(words);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2] || 0);
  if (clock[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (clock[3] === "pm" ? 12 : 0);
  }
  return hour > 23 || minute > 59 ? null : `${pad(hour)}:${pad(minute)}`;
}

/**
 * Reads the cadence a listing writes in words. Only the first clause is read, so "Every Friday evening, the weekend and ..." is Fridays.
 * Anything it does not recognise is `unsupported` with no expression; a monthly cadence is `unsupported` with the author's words.
 */
function scheduleFromWords(summary: string): GrokSchedule {
  const clause = firstClause(summary);
  const words = clause.toLowerCase().replace(/[-_]/g, " ");
  const none: GrokSchedule = { kind: "unsupported", expression: null };
  if (!words) return none;

  // A cadence Zetta has no field for: the author's own words go into the message.
  const rare =
    /\b(?:first|last|\d{1,2}(?:st|nd|rd|th)) of (?:each|every|the) (?:month|quarter|year)\b|\b(?:monthly|quarterly|yearly|annually|every month|each month)\b/i.exec(
      clause.replace(/[-_]/g, " "),
    );
  if (rare) return { kind: "unsupported", expression: rare[0] };

  const every = /\bevery (\d{1,4}) (minutes?|mins?|hours?)\b/.exec(words);
  const interval = every
    ? Number(every[1]) * (every[2]!.startsWith("h") ? 60 : 1)
    : /\b(every hour|hourly|each hour)\b/.test(words)
      ? 60
      : null;
  if (interval !== null)
    return interval >= MIN_INTERVAL && interval <= 10_080
      ? { kind: "interval", everyMinutes: interval }
      : { kind: "unsupported", expression: clause.slice(0, 80) };

  // Which days.
  const named = NAMED_DAYS.filter(([name]) => new RegExp(`\\b${name}s?\\b`).test(words)).map(
    ([, n]) => n,
  );
  const assumptions: string[] = [];
  let weekdays: number[] | null;
  if (/\bweekdays?\b/.test(words)) weekdays = [1, 2, 3, 4, 5];
  else if (/\bweekends?\b/.test(words)) weekdays = [0, 6];
  else if (named.length) weekdays = normalizeWeekdays(named);
  else if (/\b(once a week|weekly|each week|every week)\b/.test(words)) {
    weekdays = [DEFAULT_WEEKDAY];
    assumptions.push(`The listing says "${clause}" without a day, so it is set to Monday.`);
  } else if (
    /\b(daily|every day|each day|every (morning|afternoon|evening|night)|each (morning|afternoon|evening|night)|nightly)\b/.test(
      words,
    )
  )
    weekdays = null;
  else return none;

  // Which time.
  let dailyAt = explicitTime(words);
  if (!dailyAt) {
    const part = /\b(morning|afternoon|evening|night|midday|noon)\b/.exec(words)?.[1];
    dailyAt = part ? TIME_OF_DAY[part]! : DEFAULT_TIME;
    assumptions.push(
      part
        ? `The listing says "${part}" without a time, so it is set to ${dailyAt}.`
        : `The listing gives no time, so it is set to ${dailyAt}.`,
    );
  }
  return {
    kind: "daily",
    dailyAt,
    weekdays,
    ...(assumptions.length
      ? {
          assumed: `${assumptions.join(" ")} Change the time in Routines after the bot is created, or keep this routine paused until then.`,
        }
      : {}),
  };
}

/**
 * The schedule of a routine summary: a cron if it has one, else the cadence in its first words. A summary with neither (an event or
 * webhook routine, say) has no schedule to import.
 */
export function scheduleFromRoutine(summary: string): GrokSchedule {
  const found = /\bcron\s+([\d*][^\s()]*(?:\s+[^\s()]+){4})/i.exec(summary);
  return found ? scheduleFromCron(found[1]!) : scheduleFromWords(summary);
}

/** True when the author left the routine switched off ("Paused weekday sweep. Enable only when the user says so."). */
export function authorPaused(summary: string): boolean {
  return (
    /^\s*(?:paused|disabled|off)\b/i.test(summary) ||
    /\b(?:paused|disabled|off) by default\b/i.test(summary) ||
    /\benable only when\b/i.test(summary)
  );
}

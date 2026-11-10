import { describe, expect, test } from "bun:test";
import {
  authorPaused,
  describeGrokSchedule,
  scheduleFromCron,
  scheduleFromRoutine,
} from "./schedule-from-cron";

describe("describeGrokSchedule", () => {
  test.each([
    ["44 8 * * 1-5", "weekdays at 08:44"],
    ["49 8 * * 1", "Mondays at 08:49"],
    ["0 9 * * *", "every day at 09:00"],
    ["30 18 * * 0,6", "weekends at 18:30"],
    ["*/15 * * * *", "every 15 minutes"],
    ["0 9 1 * *", "a schedule Zetta can't run yet (0 9 1 * *)"],
  ])("%s reads as %s", (cron, words) => {
    expect(describeGrokSchedule(scheduleFromCron(cron))).toBe(words);
  });

  test("a time that was assumed says so", () => {
    expect(describeGrokSchedule(scheduleFromRoutine("Every weekday morning, a brief."))).toBe(
      "weekdays at 08:00 (assumed)",
    );
    expect(describeGrokSchedule(scheduleFromRoutine("Every weekday at 8am, a brief."))).toBe(
      "weekdays at 08:00",
    );
  });

  test("a routine with no cron says so", () => {
    expect(describeGrokSchedule(scheduleFromRoutine("Runs on every new email."))).toBe(
      "no schedule we could read",
    );
  });
});

describe("scheduleFromCron", () => {
  test("a fixed time every day", () => {
    expect(scheduleFromCron("0 9 * * *")).toEqual({
      kind: "daily",
      dailyAt: "09:00",
      weekdays: null,
    });
  });

  test("pads the time to HH:MM", () => {
    expect(scheduleFromCron("5 7 * * *")).toEqual({
      kind: "daily",
      dailyAt: "07:05",
      weekdays: null,
    });
  });

  test("a weekday range: Monday to Friday", () => {
    expect(scheduleFromCron("44 8 * * 1-5")).toEqual({
      kind: "daily",
      dailyAt: "08:44",
      weekdays: [1, 2, 3, 4, 5],
    });
  });

  test("a single weekday", () => {
    expect(scheduleFromCron("49 8 * * 1")).toEqual({
      kind: "daily",
      dailyAt: "08:49",
      weekdays: [1],
    });
  });

  test("a list and a range together, in week order, 7 meaning Sunday", () => {
    expect(scheduleFromCron("0 18 * * 5,1-2,7")).toEqual({
      kind: "daily",
      dailyAt: "18:00",
      weekdays: [0, 1, 2, 5],
    });
  });

  test("day names", () => {
    expect(scheduleFromCron("30 6 * * MON-WED")).toEqual({
      kind: "daily",
      dailyAt: "06:30",
      weekdays: [1, 2, 3],
    });
    expect(scheduleFromCron("30 6 * * sat,sun")).toEqual({
      kind: "daily",
      dailyAt: "06:30",
      weekdays: [0, 6],
    });
  });

  test("all seven days is the same as every day", () => {
    expect(scheduleFromCron("0 9 * * 0-6")).toEqual({
      kind: "daily",
      dailyAt: "09:00",
      weekdays: null,
    });
  });

  test("an every-N-minutes interval", () => {
    expect(scheduleFromCron("*/15 * * * *")).toEqual({ kind: "interval", everyMinutes: 15 });
  });

  test("an interval below Zetta's 5-minute floor is unsupported", () => {
    expect(scheduleFromCron("*/2 * * * *")).toEqual({
      kind: "unsupported",
      expression: "*/2 * * * *",
    });
  });

  test.each([
    ["several times a day", "0 9,17 * * *"],
    ["an hour step", "0 */2 * * *"],
    ["a day of the month", "0 9 1 * *"],
    ["a month", "0 9 * 6 *"],
    ["a weekday step", "0 9 * * */2"],
    ["a weekday out of range", "0 9 * * 8"],
    ["an hour out of range", "0 24 * * *"],
    ["a minute out of range", "60 9 * * *"],
    ["a minute list", "0,30 9 * * *"],
    ["not five fields", "0 9 * *"],
  ])("%s is unsupported", (_name, expression) => {
    expect(scheduleFromCron(expression)).toEqual({ kind: "unsupported", expression });
  });

  test("extra whitespace is fine", () => {
    expect(scheduleFromCron("  44   8  * * 1-5 ")).toEqual({
      kind: "daily",
      dailyAt: "08:44",
      weekdays: [1, 2, 3, 4, 5],
    });
  });
});

describe("scheduleFromRoutine", () => {
  test("reads the cron out of a Grok routine summary", () => {
    const summary =
      "Cron 44 8 * * 1-5 (weekdays 8:44 local). Scans recent bot transcripts for user friction; stays quiet when nothing is worth proposing.";
    expect(scheduleFromRoutine(summary)).toEqual({
      kind: "daily",
      dailyAt: "08:44",
      weekdays: [1, 2, 3, 4, 5],
    });
  });

  test("a Monday routine", () => {
    expect(
      scheduleFromRoutine("Cron 49 8 * * 1 (Mondays 8:49 local). Audits fleet routines."),
    ).toEqual({
      kind: "daily",
      dailyAt: "08:49",
      weekdays: [1],
    });
  });

  test("is case-insensitive about the word Cron", () => {
    expect(scheduleFromRoutine("cron 0 9 * * * (daily)")).toEqual({
      kind: "daily",
      dailyAt: "09:00",
      weekdays: null,
    });
  });

  test("a summary with no cron has no schedule to import", () => {
    expect(scheduleFromRoutine("Runs whenever a new email arrives.")).toEqual({
      kind: "unsupported",
      expression: null,
    });
  });

  test("an unsupported cron keeps its expression for the message", () => {
    expect(scheduleFromRoutine("Cron 0 9 1 * * (first of the month)")).toEqual({
      kind: "unsupported",
      expression: "0 9 1 * *",
    });
  });
});

// The cadence in plain English: what real listings mostly say. Phrases here are invented in the same shapes.
describe("scheduleFromRoutine: a cadence written in words", () => {
  const daily = (dailyAt: string, weekdays: number[] | null) => ({
    kind: "daily",
    dailyAt,
    weekdays,
  });

  test.each([
    ["Every weekday morning, one short brief.", "08:00", [1, 2, 3, 4, 5]],
    ["Each weekday afternoon, a quick check.", "15:00", [1, 2, 3, 4, 5]],
    ["Every Friday evening, a weekend preview.", "18:00", [5]],
    ["Every Monday morning, a report.", "08:00", [1]],
    ["Every Tuesday and Thursday afternoon, a nudge.", "15:00", [2, 4]],
    ["Every weekend morning, a plan.", "08:00", [0, 6]],
    ["Every morning, a digest.", "08:00", null],
    ["Every evening, a wrap-up.", "18:00", null],
    ["Daily, a digest.", "09:00", null],
    ["Every day, a digest.", "09:00", null],
    ["Mondays, a list.", "09:00", [1]],
  ])("%s", (text, at, days) => {
    expect(scheduleFromRoutine(text)).toMatchObject(daily(at, days));
  });

  test("a time of day that is only a word is an assumption, and says so", () => {
    const s = scheduleFromRoutine("Every weekday morning, one short brief.");
    expect(s.kind === "daily" && s.assumed).toMatch(/morning/);
    expect(s.kind === "daily" && s.assumed).toMatch(/08:00/);
  });

  test("no time at all is also an assumption", () => {
    const s = scheduleFromRoutine("Every Monday, a list.");
    expect(s.kind === "daily" && s.assumed).toMatch(/09:00/);
  });

  test("a real clock time is taken as written, with no assumption", () => {
    for (const [text, at] of [
      ["Every day at 7:30am, a note.", "07:30"],
      ["Every weekday at 6 pm, a note.", "18:00"],
      ["Every Monday at 14:15, a note.", "14:15"],
      ["Every day at 12 am, a note.", "00:00"],
      ["Every day at 12 pm, a note.", "12:00"],
      ["Every day at noon, a note.", "12:00"],
    ] as const) {
      const s = scheduleFromRoutine(text);
      expect(s).toMatchObject({ kind: "daily", dailyAt: at });
      expect(s.kind === "daily" && s.assumed).toBeFalsy();
    }
  });

  test("once a week without a day is an assumption about the day, and says so", () => {
    const s = scheduleFromRoutine("Once a week, three page ideas.");
    expect(s).toMatchObject({ kind: "daily", dailyAt: "09:00", weekdays: [1] });
    expect(s.kind === "daily" && s.assumed).toMatch(/week/i);
  });

  test("a hyphenated cadence reads the same", () => {
    expect(
      scheduleFromRoutine("Paused weekday-morning sweep. Created after an interview."),
    ).toMatchObject(daily("08:00", [1, 2, 3, 4, 5]));
  });

  test("only the first clause counts: later words about the week do not change the days", () => {
    expect(
      scheduleFromRoutine("Every Friday evening, the weekend and the week after it."),
    ).toMatchObject(daily("18:00", [5]));
  });

  test("intervals", () => {
    expect(scheduleFromRoutine("Every 15 minutes, a poll.")).toEqual({
      kind: "interval",
      everyMinutes: 15,
    });
    expect(scheduleFromRoutine("Every hour, a check.")).toEqual({
      kind: "interval",
      everyMinutes: 60,
    });
    expect(scheduleFromRoutine("Hourly, a check.")).toEqual({ kind: "interval", everyMinutes: 60 });
    expect(scheduleFromRoutine("Every 2 hours, a check.")).toEqual({
      kind: "interval",
      everyMinutes: 120,
    });
    expect(scheduleFromRoutine("Every 2 minutes, a poll.")).toEqual({
      kind: "unsupported",
      expression: "Every 2 minutes",
    });
  });

  test("monthly cadences cannot run in Zetta yet, and keep the author's words for the message", () => {
    expect(scheduleFromRoutine("On the first of each month, local events.")).toEqual({
      kind: "unsupported",
      expression: "first of each month",
    });
    expect(scheduleFromRoutine("Monthly report of things.")).toEqual({
      kind: "unsupported",
      expression: "Monthly",
    });
  });

  test("no cadence in the text (an event, a webhook) has no schedule", () => {
    expect(scheduleFromRoutine("Runs whenever a new email arrives.")).toEqual({
      kind: "unsupported",
      expression: null,
    });
    expect(scheduleFromRoutine("")).toEqual({ kind: "unsupported", expression: null });
  });

  test("a leading 'disabled by default' is not the cadence: the cadence is what follows", () => {
    expect(
      scheduleFromRoutine("Disabled by default. Daily 8:25am: numbers and flags."),
    ).toMatchObject(daily("08:25", null));
    expect(
      scheduleFromRoutine("Disabled by default. Weekly scan of the vendor list."),
    ).toMatchObject(daily("09:00", [1]));
    expect(scheduleFromRoutine("Paused. Every Friday evening, a recap.")).toMatchObject(
      daily("18:00", [5]),
    );
  });

  test("a time without 'at' is still a time", () => {
    expect(scheduleFromRoutine("Daily 7am: a note.")).toMatchObject(daily("07:00", null));
    expect(scheduleFromRoutine("Every weekday 6:45 pm, a note.")).toMatchObject(
      daily("18:45", [1, 2, 3, 4, 5]),
    );
    expect(scheduleFromRoutine("Every day 17:05, a note.")).toMatchObject(daily("17:05", null));
    expect(scheduleFromRoutine("Daily 7am: a note.")).not.toHaveProperty("assumed");
  });

  test("a monthly cadence quotes only its own words", () => {
    expect(
      scheduleFromRoutine("Fires on the 1st of each month to deliver a long rollup of many things"),
    ).toEqual({ kind: "unsupported", expression: "1st of each month" });
    expect(scheduleFromRoutine("Monthly re-pull of the cards.")).toEqual({
      kind: "unsupported",
      expression: "Monthly",
    });
    expect(scheduleFromRoutine("On the first of each month, local events.")).toEqual({
      kind: "unsupported",
      expression: "first of each month",
    });
  });

  test("a cadence that is not regular is not guessed", () => {
    for (const text of [
      "Through the workday, flags a message.",
      "After a meeting ends, drafts the recap.",
      "On the mornings you pick, runs a drill.",
      "Twice a week, re-runs the prompts.",
    ])
      expect(scheduleFromRoutine(text)).toEqual({ kind: "unsupported", expression: null });
  });

  test("a real cron wins over the words around it", () => {
    expect(
      scheduleFromRoutine(
        "Cron 44 8 * * 1-5 (weekdays 8:44 local). Every morning it scans things.",
      ),
    ).toEqual({
      kind: "daily",
      dailyAt: "08:44",
      weekdays: [1, 2, 3, 4, 5],
    });
  });
});

describe("authorPaused", () => {
  test.each([
    ["Paused weekday-morning sweep. Enable only when the user says so.", true],
    ["Enable only when asked.", true],
    ["Disabled by default. Daily 8:25am: numbers.", true],
    ["Off by default. Weekly scan.", true],
    ["Every weekday morning, a brief.", false],
    ["Cron 0 9 * * * (daily). Scans things.", false],
    ["Runs unpaused all week.", false],
  ])("%s", (text, expected) => {
    expect(authorPaused(text)).toBe(expected);
  });
});

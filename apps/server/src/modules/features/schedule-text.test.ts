import { describe, expect, test } from "bun:test";
import { describeSchedule } from "./schedule";
import { parseScheduleText } from "./schedule-text";

// A Monday, 09:00 in São Paulo (UTC-3, no daylight saving).
const NOW = new Date("2026-11-09T12:00:00Z");
const TZ = "America/Sao_Paulo";
const parse = (text: string, timezone = TZ) => parseScheduleText(text, { timezone, now: NOW });
const ok = (text: string) => {
  const r = parse(text);
  if (!r.ok) throw new Error(`"${text}" was refused: ${r.problem}`);
  return r;
};
const problem = (text: string, timezone = TZ) => {
  const r = parse(text, timezone);
  if (r.ok) throw new Error(`"${text}" was accepted as ${JSON.stringify(r.schedule)}`);
  return r.problem;
};
const WEEK = [1, 2, 3, 4, 5];

describe("days and a time of day", () => {
  test.each([
    ["Monday to Friday at 8:30", "08:30", WEEK],
    ["Mon-Fri 8:30am", "08:30", WEEK],
    ["monday through friday at 6pm", "18:00", WEEK],
    ["Monday until Friday at 7:15", "07:15", WEEK],
    ["weekdays at 8am", "08:00", WEEK],
    ["every weekday at 8:00", "08:00", WEEK],
    ["weekends at 10:00", "10:00", [0, 6]],
    ["Sat-Sun at 11am", "11:00", [0, 6]],
    ["Mon, Wed and Fri at 9", "09:00", [1, 3, 5]],
    ["every Tuesday and Thursday at 14:15", "14:15", [2, 4]],
    ["Fridays at 5pm", "17:00", [5]],
    ["every Monday at 9", "09:00", [1]],
    ["Friday at 9", "09:00", [5]],
    ["Friday to Monday at 20:00", "20:00", [0, 1, 5, 6]],
    ["Tue-Thu 18h", "18:00", [2, 3, 4]],
    ["every weekday at 18h30", "18:30", WEEK],
  ])("%s", (text, at, days) => {
    expect(ok(text).schedule).toEqual({ dailyAt: at, weekdays: days });
  });

  test.each([
    ["every day at 7am", "07:00"],
    ["daily at 07:00", "07:00"],
    ["everyday at 22:30", "22:30"],
    ["at 8:30", "08:30"],
    ["8:30", "08:30"],
    ["every day at noon", "12:00"],
    ["every day at midnight", "00:00"],
    ["every day at 12 am", "00:00"],
    ["every day at 12 pm", "12:00"],
  ])("every day: %s", (text, at) => {
    expect(ok(text).schedule).toEqual({ dailyAt: at });
  });

  test("a name for the part of the day stands for a time, and says so", () => {
    const r = ok("every weekday morning");
    expect(r.schedule).toEqual({ dailyAt: "08:00", weekdays: WEEK });
    expect(r.assumed).toMatch(/morning.*08:00/);
    expect(ok("every evening").schedule).toEqual({ dailyAt: "18:00" });
  });

  test("a real time carries no assumption", () => {
    expect(ok("Monday to Friday at 8:30").assumed).toBeNull();
  });

  test("a recurring phrase with no time asks for one", () => {
    expect(problem("every Monday")).toMatch(/time of day/i);
    expect(problem("Monday to Friday")).toMatch(/time of day/i);
    expect(problem("weekdays")).toMatch(/time of day/i);
  });

  test("case, spacing and punctuation do not matter", () => {
    expect(ok("  MONDAY TO FRIDAY, 8:30 AM. ").schedule).toEqual({
      dailyAt: "08:30",
      weekdays: WEEK,
    });
    expect(ok("monday  to   friday @ 8:30").schedule).toEqual({ dailyAt: "08:30", weekdays: WEEK });
  });

  test("a timezone in brackets, as the app writes it, is ignored", () => {
    expect(ok("weekdays at 08:30 (America/Sao_Paulo)").schedule).toEqual({
      dailyAt: "08:30",
      weekdays: WEEK,
    });
  });

  test("the whole week listed is every day", () => {
    expect(ok("Monday to Sunday at 9:00").schedule).toEqual({ dailyAt: "09:00" });
  });

  test("an impossible time is refused", () => {
    expect(problem("every day at 25:00")).toBeTruthy();
    expect(problem("every day at 9:75")).toBeTruthy();
    expect(problem("every day at 13 pm")).toBeTruthy();
  });
});

describe("intervals", () => {
  test.each([
    ["every 15 minutes", 15],
    ["every 5 min", 5],
    ["every 2 hours", 120],
    ["every hour", 60],
    ["hourly", 60],
    ["every 1 hour", 60],
    ["every 168 hours", 10_080],
  ])("%s", (text, minutes) => {
    expect(ok(text).schedule).toEqual({ everyMinutes: minutes });
  });

  test("below five minutes or over a week is refused with the limits", () => {
    expect(problem("every 2 minutes")).toMatch(/5 minutes/);
    expect(problem("every 200 hours")).toMatch(/7 days|week/);
  });
});

describe("cron", () => {
  test.each([
    ["0 9 * * 1-5", { dailyAt: "09:00", weekdays: WEEK }],
    ["cron 44 8 * * 1-5", { dailyAt: "08:44", weekdays: WEEK }],
    ["30 18 * * *", { dailyAt: "18:30" }],
    ["0 9 * * mon,wed,fri", { dailyAt: "09:00", weekdays: [1, 3, 5] }],
    ["*/15 * * * *", { everyMinutes: 15 }],
  ])("%s", (text, schedule) => {
    expect(ok(text).schedule).toEqual(schedule);
  });

  test("a cron Zetta cannot run says what it can", () => {
    for (const text of ["0 9 1 * *", "0 9,17 * * *", "*/2 * * * *", "0 */2 * * *"])
      expect(problem(text)).toMatch(/one time a day|every N minutes|every few minutes/i);
  });

  test("five words that are not a cron are not read as one", () => {
    expect(problem("send it every other blue moon")).toBeTruthy();
  });
});

describe("one-time dates, read by chrono-node in the routine's timezone", () => {
  test("tomorrow at 5pm", () => {
    expect(ok("tomorrow at 5pm").schedule).toEqual({ onceAt: "2026-11-10T20:00:00.000Z" });
  });

  // The machine running the tests may be in any timezone; these hold wherever it is.
  test.each([
    ["Europe/Lisbon", "2026-11-10T17:00:00.000Z"],
    ["Asia/Tokyo", "2026-11-10T08:00:00.000Z"],
    ["America/New_York", "2026-11-10T22:00:00.000Z"],
    ["UTC", "2026-11-10T17:00:00.000Z"],
  ])("tomorrow at 5pm in %s", (tz, onceAt) => {
    const r = parse("tomorrow at 5pm", tz);
    expect(r.ok && r.schedule).toEqual({ onceAt });
  });

  test("a date after a daylight-saving change uses the offset of that date, not of today", () => {
    // New York is UTC-5 in November and UTC-4 from 14 March 2027.
    const r = parse("on March 20 at 9am", "America/New_York");
    expect(r.ok && r.schedule).toEqual({ onceAt: "2027-03-20T13:00:00.000Z" });
  });

  test("next Friday at 9:30", () => {
    expect(ok("next Friday at 9:30").schedule).toEqual({ onceAt: "2026-11-20T12:30:00.000Z" });
  });

  test("a date with a month name", () => {
    expect(ok("on December 12 at noon").schedule).toEqual({ onceAt: "2026-12-12T15:00:00.000Z" });
  });

  test("in two hours", () => {
    expect(ok("in 2 hours").schedule).toEqual({ onceAt: "2026-11-09T14:00:00.000Z" });
  });

  test("a date with no time asks for a time", () => {
    expect(problem("tomorrow")).toMatch(/time/i);
    expect(problem("on December 12")).toMatch(/time/i);
  });

  test("a moment already past is refused", () => {
    expect(problem("yesterday at 5pm")).toMatch(/passed|past/i);
  });

  test("says what it understood, in the routine's timezone", () => {
    expect(ok("tomorrow at 5pm").understood).toMatch(
      /once.*10 Nov 2026.*17:00.*America\/Sao_Paulo/,
    );
  });
});

describe("what it says back", () => {
  test("a recurring schedule is described the way the app describes routines", () => {
    expect(ok("Monday to Friday at 8:30").understood).toBe("weekdays at 08:30 (America/Sao_Paulo)");
    expect(ok("every day at 7am").understood).toBe("every day at 07:00 (America/Sao_Paulo)");
    expect(ok("every 15 minutes").understood).toBe("every 15 minutes");
  });

  test.each([
    { dailyAt: "08:44", weekdays: null },
    { dailyAt: "08:44", weekdays: [1, 2, 3, 4, 5] },
    { dailyAt: "08:49", weekdays: [1] },
    { dailyAt: "10:00", weekdays: [0, 6] },
    { dailyAt: "09:00", weekdays: [1, 3, 5] },
    { dailyAt: "20:00", weekdays: [5, 6, 0, 1] },
    { dailyAt: "09:00", weekdays: [2, 4] },
  ])("what the app writes for %j reads back as the same schedule", (s) => {
    const text = describeSchedule({
      timezone: TZ,
      dailyAt: s.dailyAt,
      everyMinutes: null,
      weekdays: s.weekdays,
    });
    const r = ok(text);
    expect(r.schedule).toEqual(
      s.weekdays
        ? { dailyAt: s.dailyAt, weekdays: [...s.weekdays].sort((a, b) => a - b) }
        : { dailyAt: s.dailyAt },
    );
  });

  test("an interval reads back too", () => {
    expect(
      ok(describeSchedule({ timezone: TZ, dailyAt: null, everyMinutes: 45 })).schedule,
    ).toEqual({ everyMinutes: 45 });
  });
});

describe("what it cannot read", () => {
  test("nothing, or only spaces", () => {
    expect(problem("")).toMatch(/say when/i);
    expect(problem("   ")).toMatch(/say when/i);
  });

  test("gibberish gets examples to follow", () => {
    const p = problem("blah blah");
    expect(p).toMatch(/Monday to Friday/);
    expect(p).toMatch(/every 15 minutes/);
    expect(p).toMatch(/tomorrow at 5pm/);
  });

  test("a very long text is refused, not parsed", () => {
    expect(problem("every day at 9am ".repeat(40))).toMatch(/too long/i);
  });

  test("a timezone that does not exist is refused", () => {
    expect(problem("every day at 9am", "Mars/Olympus_Mons")).toMatch(/timezone/i);
  });

  test("monthly cadences say they are not supported", () => {
    expect(problem("on the first of each month at 9am")).toMatch(/month/i);
    expect(problem("monthly at 9am")).toMatch(/month/i);
  });
});

import { describe, expect, test } from "bun:test";
import {
  computeNextRun,
  describeSchedule,
  nextDailyRun,
  normalizeWeekdays,
  previewRuns,
} from "./schedule";

const SP = "America/Sao_Paulo"; // UTC-3, no DST since 2019
const NY = "America/New_York"; // DST starts 2026-03-08

describe("nextDailyRun with weekdays", () => {
  test("without weekdays it is unchanged: the next 08:44", () => {
    const next = nextDailyRun(new Date("2026-11-09T12:00:00Z"), SP, "08:44");
    expect(next.toISOString()).toBe("2026-11-10T11:44:00.000Z");
  });

  test("Monday to Friday skips the weekend", () => {
    // 2026-11-13 is a Friday; 08:44 São Paulo is 11:44Z. After that, the next run is Monday the 16th.
    const next = nextDailyRun(new Date("2026-11-13T12:00:00Z"), SP, "08:44", [1, 2, 3, 4, 5]);
    expect(next.toISOString()).toBe("2026-11-16T11:44:00.000Z");
  });

  test("a single weekday waits for that day", () => {
    // 2026-11-09 is a Monday and 08:49 has not passed yet in São Paulo (11:49Z): runs today.
    const today = nextDailyRun(new Date("2026-11-09T10:00:00Z"), SP, "08:49", [1]);
    expect(today.toISOString()).toBe("2026-11-09T11:49:00.000Z");
    // Right after, the next Monday is a week later.
    const week = nextDailyRun(new Date("2026-11-09T12:00:00Z"), SP, "08:49", [1]);
    expect(week.toISOString()).toBe("2026-11-16T11:49:00.000Z");
  });

  test("the weekday is read in the routine timezone, not in UTC", () => {
    // Sunday 2026-11-15 22:30 in São Paulo is already Monday 01:30Z. A Sunday-only 21:00 routine must still be Sunday local.
    const next = nextDailyRun(new Date("2026-11-15T00:30:00Z"), SP, "21:00", [0]);
    expect(next.toISOString()).toBe("2026-11-16T00:00:00.000Z"); // Sunday 21:00 local
  });

  test("keeps the wall-clock time across a DST change", () => {
    // New York leaves EST on 2026-03-08. Monday 09:00 before the change is 14:00Z, after it is 13:00Z.
    const after = nextDailyRun(new Date("2026-03-07T00:00:00Z"), NY, "09:00", [1]);
    expect(after.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  test("an empty list means every day", () => {
    const next = nextDailyRun(new Date("2026-11-13T12:00:00Z"), SP, "08:44", []);
    expect(next.toISOString()).toBe("2026-11-14T11:44:00.000Z");
  });
});

describe("computeNextRun and previewRuns", () => {
  test("a recurring routine with weekdays uses them", () => {
    const next = computeNextRun(new Date("2026-11-13T12:00:00Z"), {
      timezone: SP,
      dailyAt: "08:44",
      everyMinutes: null,
      weekdays: [1, 2, 3, 4, 5],
    });
    expect(next?.toISOString()).toBe("2026-11-16T11:44:00.000Z");
  });

  test("three previews go Fri, Mon, Tue", () => {
    const runs = previewRuns(
      new Date("2026-11-13T09:00:00Z"),
      { timezone: SP, dailyAt: "08:44", everyMinutes: null, weekdays: [1, 2, 3, 4, 5] },
      3,
    ).map((d) => d.toISOString());
    expect(runs).toEqual([
      "2026-11-13T11:44:00.000Z",
      "2026-11-16T11:44:00.000Z",
      "2026-11-17T11:44:00.000Z",
    ]);
  });

  test("weekdays are ignored for an interval routine", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const next = computeNextRun(now, {
      timezone: SP,
      dailyAt: null,
      everyMinutes: 30,
      weekdays: [1],
    });
    expect(next?.getTime()).toBe(now.getTime() + 30 * 60_000);
  });
});

describe("normalizeWeekdays", () => {
  test("sorts, removes duplicates and bad values", () => {
    expect(normalizeWeekdays([5, 1, 1, 3, 9, -1, 2.5])).toEqual([1, 3, 5]);
  });

  test("none, empty or all seven days mean every day (null)", () => {
    expect(normalizeWeekdays(undefined)).toBeNull();
    expect(normalizeWeekdays(null)).toBeNull();
    expect(normalizeWeekdays([])).toBeNull();
    expect(normalizeWeekdays([6, 5, 4, 3, 2, 1, 0])).toBeNull();
  });
});

describe("describeSchedule", () => {
  const base = { timezone: SP, everyMinutes: null };

  test("every day stays as it was", () => {
    expect(describeSchedule({ ...base, dailyAt: "08:44" })).toBe(`every day at 08:44 (${SP})`);
  });

  test("Monday to Friday reads as weekdays", () => {
    expect(describeSchedule({ ...base, dailyAt: "08:44", weekdays: [1, 2, 3, 4, 5] })).toBe(
      `weekdays at 08:44 (${SP})`,
    );
  });

  test("a single day is named", () => {
    expect(describeSchedule({ ...base, dailyAt: "08:49", weekdays: [1] })).toBe(
      `Mondays at 08:49 (${SP})`,
    );
  });

  test("a list is joined in week order", () => {
    expect(describeSchedule({ ...base, dailyAt: "09:00", weekdays: [5, 1, 3] })).toBe(
      `Mon, Wed, Fri at 09:00 (${SP})`,
    );
  });

  test("every day listed reads as every day", () => {
    expect(describeSchedule({ ...base, dailyAt: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe(
      `every day at 09:00 (${SP})`,
    );
  });
});

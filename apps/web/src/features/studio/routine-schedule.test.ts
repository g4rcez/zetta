import { describe, expect, test } from "bun:test";

import { buildSchedule, describeDays, describeSchedule, scheduleText } from "./routine-schedule";

const base = { timezone: "UTC", dailyAt: "", everyMinutes: "", onceLocal: "" };
describe("buildSchedule", () => {
  test("daily needs HH:MM", () => {
    expect(buildSchedule({ ...base, mode: "daily", dailyAt: "09:30" })).toEqual({
      ok: true,
      value: { timezone: "UTC", dailyAt: "09:30" },
    });
    expect(buildSchedule({ ...base, mode: "daily" }).ok).toBe(false);
  });
  test("interval is bounded", () => {
    expect(buildSchedule({ ...base, mode: "interval", everyMinutes: "15" })).toEqual({
      ok: true,
      value: { timezone: "UTC", everyMinutes: 15 },
    });
    expect(buildSchedule({ ...base, mode: "interval", everyMinutes: "2" }).ok).toBe(false);
  });
  test("once becomes an ISO instant", () => {
    const r = buildSchedule({ ...base, mode: "once", onceLocal: "2030-01-02T03:04" });
    expect(r.ok && /^\d{4}-\d\d-\d\dT.*Z$/.test(r.value.onceAt!)).toBe(true);
    expect(buildSchedule({ ...base, mode: "once", onceLocal: "" }).ok).toBe(false);
  });
  test("described in words, the text is sent for the server to read", () => {
    expect(buildSchedule({ ...base, mode: "text", text: "  Monday to Friday at 8:30 " })).toEqual({
      ok: true,
      value: { timezone: "UTC", when: "Monday to Friday at 8:30" },
    });
  });
  test("described in words, empty text asks for the schedule with an example", () => {
    const r = buildSchedule({ ...base, mode: "text", text: "   " });
    expect(!r.ok && r.problem).toMatch(/Monday to Friday/);
    expect(buildSchedule({ ...base, mode: "text" }).ok).toBe(false);
  });
  test("timezone is required", () =>
    expect(buildSchedule({ ...base, timezone: " ", mode: "daily", dailyAt: "09:00" }).ok).toBe(
      false,
    ));
});
test("describeSchedule", () => {
  expect(describeSchedule({ dailyAt: "08:00", everyMinutes: null, timezone: "UTC" })).toBe(
    "every day at 08:00 (UTC)",
  );
  expect(describeSchedule({ dailyAt: null, everyMinutes: 120, timezone: "UTC" })).toBe(
    "every 2 hours",
  );
  expect(describeSchedule({ dailyAt: null, everyMinutes: 60, timezone: "UTC" })).toBe("every hour");
  expect(describeSchedule({ dailyAt: null, everyMinutes: 45, timezone: "UTC" })).toBe(
    "every 45 minutes",
  );
});

test("describeSchedule says the days a routine runs on", () => {
  const daily = (weekdays: number[] | null) => ({
    dailyAt: "08:30",
    everyMinutes: null,
    weekdays,
    timezone: "UTC",
  });
  expect(describeSchedule(daily([1, 2, 3, 4, 5]))).toBe("weekdays at 08:30 (UTC)");
  expect(describeSchedule(daily([1]))).toBe("Mondays at 08:30 (UTC)");
  expect(describeSchedule(daily([0, 6]))).toBe("weekends at 08:30 (UTC)");
  expect(describeSchedule(daily([5, 1, 3]))).toBe("Mon, Wed, Fri at 08:30 (UTC)");
  expect(describeSchedule(daily([0, 1, 2, 3, 4, 5, 6]))).toBe("every day at 08:30 (UTC)");
  expect(describeSchedule(daily(null))).toBe("every day at 08:30 (UTC)");
  expect(describeSchedule(daily([]))).toBe("every day at 08:30 (UTC)");
});

test("describeSchedule in 12 hour time writes the clock the person reads", () => {
  expect(
    describeSchedule(
      { dailyAt: "18:05", everyMinutes: null, weekdays: [1, 2, 3, 4, 5], timezone: "UTC" },
      "12h",
    ),
  ).toMatch(/^weekdays at 6:05\s?PM \(UTC\)$/i);
});

test("describeDays", () => {
  expect(describeDays(null)).toBe("every day");
  expect(describeDays([3, 1])).toBe("Mon, Wed");
});

describe("scheduleText: what the edit form starts from, always readable by the server", () => {
  test("a recurring routine, with the days and the time in 24 hours and no timezone", () => {
    expect(scheduleText({ dailyAt: "08:44", everyMinutes: null, weekdays: [1, 2, 3, 4, 5] })).toBe(
      "weekdays at 08:44",
    );
    expect(scheduleText({ dailyAt: "08:44", everyMinutes: null })).toBe("every day at 08:44");
    expect(scheduleText({ dailyAt: null, everyMinutes: 30 })).toBe("every 30 minutes");
    expect(scheduleText({ dailyAt: null, everyMinutes: 180 })).toBe("every 3 hours");
  });
  test("a one-time or empty schedule has no text to edit", () => {
    expect(
      scheduleText({
        kind: "once",
        dailyAt: null,
        everyMinutes: null,
        onceAt: "2030-01-01T00:00:00Z",
      }),
    ).toBe("");
    expect(scheduleText({ dailyAt: null, everyMinutes: null })).toBe("");
  });
});

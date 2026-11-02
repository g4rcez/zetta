import { describe, expect, test } from "bun:test";

import { formatDateTime, formatTime } from "./time-format";
import { describeSchedule } from "../studio/routine-schedule";

// 2026-03-04 15:05 and 00:30 in local time, so the result does not depend on the machine's time zone.
const afternoon = new Date(2026, 2, 4, 15, 5);
const midnight = new Date(2026, 2, 4, 0, 30);

describe("hour format preference", () => {
  test("24h shows the afternoon as 15:05", () => {
    expect(formatTime(afternoon, "24h")).toContain("15:05");
  });

  test("24h shows just after midnight as 00:30, never 24:30", () => {
    expect(formatTime(midnight, "24h")).toContain("00:30");
  });

  test("12h shows the afternoon with a PM marker", () => {
    expect(formatTime(afternoon, "12h")).toMatch(/^3:05\s?PM$/i);
  });

  test("a date with an hour follows the same choice", () => {
    expect(formatDateTime(afternoon, "12h")).toMatch(/3:05:\d\d\s?PM/i);
    expect(formatDateTime(afternoon, "24h")).toContain("15:05:");
  });

  test("a routine that runs daily reads in the chosen format", () => {
    const daily = { dailyAt: "15:05", everyMinutes: null, timezone: "UTC" };
    expect(describeSchedule(daily)).toBe("every day at 15:05 (UTC)");
    expect(describeSchedule(daily, "12h")).toMatch(/^every day at 3:05\s?PM \(UTC\)$/i);
  });
});

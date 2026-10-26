import { describe, expect, test } from "bun:test";

import { buildSchedule, describeSchedule } from "./routine-schedule";

const base = { timezone: "UTC", dailyAt: "", everyMinutes: "", onceLocal: "" };
describe("buildSchedule", () => {
  test("daily needs HH:MM", () => {
    expect(buildSchedule({ ...base, mode: "daily", dailyAt: "09:30" })).toEqual({ ok: true, value: { timezone: "UTC", dailyAt: "09:30" } });
    expect(buildSchedule({ ...base, mode: "daily" }).ok).toBe(false);
  });
  test("interval is bounded", () => {
    expect(buildSchedule({ ...base, mode: "interval", everyMinutes: "15" })).toEqual({ ok: true, value: { timezone: "UTC", everyMinutes: 15 } });
    expect(buildSchedule({ ...base, mode: "interval", everyMinutes: "2" }).ok).toBe(false);
  });
  test("once becomes an ISO instant", () => {
    const r = buildSchedule({ ...base, mode: "once", onceLocal: "2030-01-02T03:04" });
    expect(r.ok && /^\d{4}-\d\d-\d\dT.*Z$/.test(r.value.onceAt!)).toBe(true);
    expect(buildSchedule({ ...base, mode: "once", onceLocal: "" }).ok).toBe(false);
  });
  test("timezone is required", () => expect(buildSchedule({ ...base, timezone: " ", mode: "daily", dailyAt: "09:00" }).ok).toBe(false));
});
test("describeSchedule", () => {
  expect(describeSchedule({ dailyAt: "08:00", everyMinutes: null, timezone: "UTC" })).toBe("every day at 08:00 (UTC)");
  expect(describeSchedule({ dailyAt: null, everyMinutes: 120, timezone: "UTC" })).toBe("every 2 hour(s)");
});

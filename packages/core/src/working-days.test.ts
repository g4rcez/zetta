import { describe, expect, test } from "bun:test";
import { addWorkingMs, workingDaysBetween, workingMsBetween } from "./working-days";

const HOUR = 60 * 60_000;

describe("working days", () => {
  test("a weekend is not counted", () => {
    // Friday 18:00 UTC to Monday 09:00 UTC: 6 hours of Friday and 9 of Monday.
    const friday = new Date("2026-11-13T18:00:00Z");
    const monday = new Date("2026-11-16T09:00:00Z");
    expect(workingMsBetween(friday, monday)).toBe(15 * HOUR);
    expect(workingDaysBetween(friday, monday)).toBe(0);
  });
  test("weekdays count in full", () => {
    const monday = new Date("2026-11-09T10:00:00Z");
    const thursday = new Date("2026-11-12T10:00:00Z");
    expect(workingDaysBetween(monday, thursday)).toBe(3);
  });
  test("a full week is five working days", () => {
    const a = new Date("2026-11-09T00:00:00Z");
    const b = new Date("2026-11-16T00:00:00Z");
    expect(workingDaysBetween(a, b)).toBe(5);
  });
  test("the weekend follows the time zone", () => {
    // Saturday 01:00 UTC is still Friday 22:00 in São Paulo.
    const from = new Date("2026-11-14T01:00:00Z");
    const to = new Date("2026-11-14T02:00:00Z");
    expect(workingMsBetween(from, to, "UTC")).toBe(0);
    expect(workingMsBetween(from, to, "America/Sao_Paulo")).toBe(HOUR);
  });
  test("an unknown time zone falls back to UTC and an inverted range is zero", () => {
    const a = new Date("2026-11-09T10:00:00Z");
    const b = new Date("2026-11-09T12:00:00Z");
    expect(workingMsBetween(a, b, "Not/AZone")).toBe(2 * HOUR);
    expect(workingMsBetween(b, a)).toBe(0);
  });
  test("a working day after Friday afternoon is Monday afternoon", () => {
    const friday = new Date("2026-11-13T15:00:00Z");
    expect(addWorkingMs(friday, 24 * HOUR).toISOString()).toBe("2026-11-16T15:00:00.000Z");
    const tuesday = new Date("2026-11-10T09:30:00Z");
    expect(addWorkingMs(tuesday, 24 * HOUR).toISOString()).toBe("2026-11-11T09:30:00.000Z");
    // Asked on a Saturday: the clock starts on Monday.
    const saturday = new Date("2026-11-14T10:00:00Z");
    expect(addWorkingMs(saturday, 2 * HOUR).toISOString()).toBe("2026-11-16T02:00:00.000Z");
    expect(addWorkingMs(tuesday, 0)).toEqual(tuesday);
  });
});

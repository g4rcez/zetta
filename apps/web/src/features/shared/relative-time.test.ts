import { describe, expect, test } from "bun:test";
import { relativeTime } from "./relative-time";

const now = Date.parse("2026-01-01T12:00:00Z");
const at = (seconds: number) => new Date(now + seconds * 1000).toISOString();

describe("relativeTime", () => {
  test("past", () => {
    expect(relativeTime(at(-20 * 60), now, "en")).toBe("20m ago");
    expect(relativeTime(at(-3 * 3600), now, "en")).toBe("3h ago");
    expect(relativeTime(at(-2 * 86400), now, "en")).toBe("2d ago");
    expect(relativeTime(at(-95 * 86400), now, "en")).toBe("3mo ago");
    expect(relativeTime(at(-800 * 86400), now, "en")).toBe("2y ago");
  });
  test("one day reads as a word, one month or year stays numeric", () => {
    expect(relativeTime(at(-86400), now, "en")).toBe("yesterday");
    expect(relativeTime(at(86400), now, "en")).toBe("tomorrow");
    expect(relativeTime(at(-31 * 86400), now, "en")).toBe("1mo ago");
    expect(relativeTime(at(-400 * 86400), now, "en")).toBe("1y ago");
  });
  test("future", () => {
    expect(relativeTime(at(3 * 3600), now, "en")).toBe("in 3h");
    expect(relativeTime(at(60), now, "en")).toBe("in 1m");
  });
  test("rounds toward now, so 59 minutes is not an hour", () => {
    expect(relativeTime(at(-59 * 60 - 59), now, "en")).toBe("59m ago");
    expect(relativeTime(at(-3600 - 1), now, "en")).toBe("1h ago");
  });
  test("under a minute is now, in both directions", () => {
    expect(relativeTime(at(-30), now, "en")).toBe("now");
    expect(relativeTime(at(30), now, "en")).toBe("now");
    expect(relativeTime(at(0), now, "en")).toBe("now");
  });
  test("an unreadable date is now", () => {
    expect(relativeTime("not a date", now, "en")).toBe("now");
  });
});

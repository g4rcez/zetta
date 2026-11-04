import { describe, expect, test } from "bun:test";
import { summarize } from "./routine-format";

const now = Date.parse("2026-01-01T12:00:00Z");
const at = (min: number) => new Date(now + min * 60_000).toISOString();

describe("summarize", () => {
  test("running, attention and next together", () => {
    const rows = [
      { title: "A", paused: false, status: "running", nextRunAt: at(60) },
      { title: "B", paused: false, status: "failed", nextRunAt: at(180) },
      { title: "C", paused: true, status: "paused", nextRunAt: null },
    ];
    expect(summarize(rows, now, "en")).toBe("1 running now · 1 needs attention · Next: A in 1h");
  });
  test("all paused", () => {
    expect(
      summarize([{ title: "C", paused: true, status: "paused", nextRunAt: null }], now, "en"),
    ).toBe("Nothing is running and nothing is scheduled.");
  });
  test("no routines gives no sentence", () => {
    expect(summarize([], now, "en")).toBe("");
  });
});

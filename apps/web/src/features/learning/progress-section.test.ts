import { describe, expect, test } from "bun:test";

import type { BotProgress, ProgressWeek } from "./learning-api";
import { progressChart, progressSentence } from "./progress-section";

const week = (start: string, over: Partial<ProgressWeek> = {}): ProgressWeek => ({
  start,
  replies: 0,
  stepIns: 0,
  per100: null,
  started: 0,
  kept: 0,
  dropped: 0,
  ...over,
});
const progress = (over: Partial<BotProgress> = {}): BotProgress => ({
  weeks: [week("2026-11-09", { replies: 10, stepIns: 2, per100: 20 }), week("2026-11-16")],
  recent: { replies: 100, stepIns: 12, per100: 12 },
  earlier: { replies: 100, stepIns: 40, per100: 40 },
  lessons: { trial: 0, kept: 0, dropped: 0, waiting: 0 },
  ...over,
});

describe("progressSentence", () => {
  test("better, worse and about the same each say how much, in numbers a person can check", () => {
    expect(progressSentence(progress())).toBe(
      "Better: 12 step-ins per 100 replies in the last four weeks, down from 40 (28 fewer).",
    );
    expect(
      progressSentence(
        progress({
          recent: { replies: 50, stepIns: 25, per100: 50 },
          earlier: { replies: 50, stepIns: 10, per100: 20 },
        }),
      ),
    ).toBe("Worse: 50 step-ins per 100 replies in the last four weeks, up from 20 (30 more).");
    expect(
      progressSentence(
        progress({
          recent: { replies: 50, stepIns: 10, per100: 20 },
          earlier: { replies: 50, stepIns: 11, per100: 21 },
        }),
      ),
    ).toContain("About the same as before");
  });
  test("with too little to compare it says so instead of guessing", () => {
    expect(progressSentence(progress({ recent: null, earlier: null }))).toContain("Not enough");
    expect(progressSentence(progress({ earlier: null }))).toContain("no earlier period");
  });
});

describe("progressChart", () => {
  test("one point per week that had judged replies, labelled by its Monday; a quiet week is left out, not drawn as zero", () => {
    const c = progressChart(progress());
    expect(c.type).toBe("line");
    expect(c.categories).toEqual(["Nov 9"]);
    expect(c.series[0]!.values).toEqual([20]);
  });
});

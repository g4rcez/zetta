import { describe, expect, test } from "bun:test";
import { trialDecision, usefulnessVerdict, type UsefulnessStats } from "./learning";

const stats = (over: Partial<UsefulnessStats> = {}): UsefulnessStats => ({
  uses: 10,
  good: 8,
  bad: 2,
  ambient: 0,
  lastUsedDaysAgo: 1,
  baselineBadRate: 0.2,
  ...over,
});

describe("usefulnessVerdict", () => {
  test("nothing used it: unused, and an item that is always in the prompt is unclear, not unused", () => {
    expect(
      usefulnessVerdict(stats({ uses: 0, good: 0, bad: 0, lastUsedDaysAgo: null })).label,
    ).toBe("unused");
    const always = usefulnessVerdict(
      stats({ uses: 0, good: 0, bad: 0, ambient: 40, lastUsedDaysAgo: null }),
    );
    expect(always.label).toBe("unclear");
    expect(always.reason).toContain("Always in the prompt");
  });

  test("used long ago is unused, with the number of days", () => {
    const v = usefulnessVerdict(stats({ lastUsedDaysAgo: 45 }));
    expect(v.label).toBe("unused");
    expect(v.reason).toContain("45 days");
  });

  test("too few judged replies is unclear, and says how many it takes", () => {
    const v = usefulnessVerdict(stats({ uses: 9, good: 2, bad: 1 }));
    expect(v.label).toBe("unclear");
    expect(v.reason).toContain("only 3 of those replies were judged");
  });

  test("helps: the person stepped in no more often than usual, and at least one reply was good", () => {
    const v = usefulnessVerdict(stats({ uses: 12, good: 11, bad: 1, baselineBadRate: 0.2 }));
    expect(v.label).toBe("helps");
    expect(v.reason).toBe(
      "Used 12 times. The person stepped in after 8% of the replies that used it. The person stepped in 20% of the time for this bot in general.",
    );
  });

  test("hurts: the person steps in clearly more often than usual", () => {
    expect(usefulnessVerdict(stats({ good: 4, bad: 6, baselineBadRate: 0.2 })).label).toBe("hurts");
    // A bot whose person steps in a lot anyway: 50% is not "more than usual".
    expect(usefulnessVerdict(stats({ good: 5, bad: 5, baselineBadRate: 0.5 })).label).toBe(
      "unclear",
    );
  });

  test("with no baseline, only a clearly high rate hurts and only a low one helps", () => {
    expect(usefulnessVerdict(stats({ good: 4, bad: 6, baselineBadRate: null })).label).toBe(
      "hurts",
    );
    expect(usefulnessVerdict(stats({ good: 9, bad: 1, baselineBadRate: null })).label).toBe(
      "helps",
    );
    expect(usefulnessVerdict(stats({ good: 7, bad: 3, baselineBadRate: null })).label).toBe(
      "unclear",
    );
  });
});

const rep = (o: "good" | "bad" | "neutral", n: number) => Array<typeof o>(n).fill(o);

describe("trialDecision", () => {
  test("normal: kept after five resolved uses with no bad one among the last three; neutral uses count as uses", () => {
    expect(trialDecision([...rep("good", 4)], null)).toBe("wait");
    expect(trialDecision([...rep("good", 5)], null)).toBe("keep");
    expect(trialDecision([...rep("neutral", 3), ...rep("good", 2)], null)).toBe("keep");
    // A bad one long ago does not hold it back, a recent one does.
    expect(trialDecision(["bad", ...rep("good", 5)], 0.5)).toBe("keep");
    expect(trialDecision([...rep("good", 4), "bad"], 0.9)).toBe("wait");
  });

  test("normal: dropped after two bad results when the bad rate is at least 40% and clearly above the bot's usual", () => {
    expect(trialDecision(["bad", "good", "good"], 0.1)).toBe("wait"); // one bad is not enough
    expect(trialDecision(["bad", "bad", "good"], 0.1)).toBe("drop");
    expect(trialDecision(["bad", "bad", ...rep("good", 3)], 0.1)).toBe("drop"); // 40%
    expect(trialDecision(["bad", "bad", ...rep("good", 4)], 0.1)).toBe("wait"); // 33%: not dropped, and not kept while it is clearly above the usual 10%
    expect(trialDecision(["bad", "bad", ...rep("good", 4)], null)).toBe("keep");
  });

  test("an item that takes the blame for every correction is judged against the bot's usual rate, not alone", () => {
    // The person steps in 45% of the time for this bot anyway: 2 bad of 3 is not clearly worse than that.
    expect(trialDecision(["bad", "bad", "good"], 0.6)).toBe("wait");
    expect(trialDecision(["bad", "bad", "good"], 0.45)).toBe("drop");
  });

  test("strict keeps nothing before eight clean uses and drops at the first bad result; loose settles fast", () => {
    expect(trialDecision(rep("good", 7), null, "strict")).toBe("wait");
    expect(trialDecision(rep("good", 8), null, "strict")).toBe("keep");
    expect(trialDecision(["good", "bad"], 0.1, "strict")).toBe("drop");
    expect(trialDecision(rep("good", 3), null, "loose")).toBe("keep");
    expect(trialDecision(["bad", "bad", "good"], 0.1, "loose")).toBe("wait");
    expect(trialDecision(["bad", "bad", "bad"], 0.1, "loose")).toBe("drop");
  });
});

describe("usefulnessVerdict: new is not unused", () => {
  const none = {
    uses: 0,
    good: 0,
    bad: 0,
    ambient: 0,
    lastUsedDaysAgo: null,
    baselineBadRate: null,
  };
  test("something added a few days ago that nothing used yet is new; after a month it is unused", () => {
    expect(usefulnessVerdict({ ...none, ageDays: 0.2 })).toEqual({
      label: "unclear",
      reason: "New: added today, nothing has used it yet.",
    });
    expect(usefulnessVerdict({ ...none, ageDays: 1.5 }).reason).toBe(
      "New: added yesterday, nothing has used it yet.",
    );
    expect(usefulnessVerdict({ ...none, ageDays: 12 }).reason).toBe(
      "New: added 12 days ago, nothing has used it yet.",
    );
    expect(usefulnessVerdict({ ...none, ageDays: 31 }).label).toBe("unused");
    // An age nobody knows keeps the old reading, and "always in the prompt" still wins over "new".
    expect(usefulnessVerdict(none).label).toBe("unused");
    expect(usefulnessVerdict({ ...none, ambient: 3, ageDays: 2 }).reason).toContain(
      "Always in the prompt",
    );
  });
});

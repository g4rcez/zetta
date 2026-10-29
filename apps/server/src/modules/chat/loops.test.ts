import { describe, expect, test } from "bun:test";
import { loopPrompt, roomLoopPrompt, type GoalLoop } from "./loops";

const loop = {
  goal: "Ship the landing page",
  doneWhen: "the page is live",
  progress: "",
} as GoalLoop;

describe("loop prompts", () => {
  test("a bot picks the method itself and hands off only for blockers", () => {
    for (const p of [loopPrompt(loop, 2), roomLoopPrompt(loop, 2)]) {
      expect(p).toContain("Pick it yourself");
      expect(p).toContain("sign-in, CAPTCHA, payment");
      expect(p).not.toContain("a decision");
    }
  });
});

describe("room loop prompt", () => {
  test("gives the facilitator the goal, the finish line and the step number", () => {
    const p = roomLoopPrompt(loop, 3);
    expect(p).toContain("(step 3)");
    expect(p).toContain("Goal: Ship the landing page");
    expect(p).toContain("Done when: the page is live");
    expect(p).toContain("nothing yet, this is the first step");
  });
  test("tells the facilitator to report only when no member owes an answer, and carries earlier progress", () => {
    const p = roomLoopPrompt({ ...loop, progress: "Hero section done" }, 2);
    expect(p).toContain("Progress so far: Hero section done");
    expect(p).toContain("reply WITHOUT mentioning anyone");
    expect(p).toContain("zetta:goal_progress");
    expect(p).toContain("zetta:goal_done");
  });
});

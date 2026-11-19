import { describe, expect, test } from "bun:test";
import { looksLikeCorrection } from "./corrections";
import { resolveOutcome } from "./outcomes";

describe("resolveOutcome", () => {
  test("no signal is neutral, and a signal said twice counts once", () => {
    expect(resolveOutcome([])).toEqual({ outcome: "neutral", weight: 0, signals: [] });
    expect(resolveOutcome(["carried_on", "carried_on"])).toMatchObject({
      outcome: "good",
      weight: 1,
    });
  });

  test("the person stepping in is bad: a correction, a stop, a steer, a thumb down", () => {
    for (const s of ["corrected", "stopped", "steered", "thumbs_down"] as const)
      expect(resolveOutcome([s]).outcome).toBe("bad");
    // Carrying on after a thumb down does not cancel it.
    expect(resolveOutcome(["thumbs_down", "carried_on"])).toMatchObject({
      outcome: "bad",
      weight: -2,
    });
  });

  test("the work being accepted is good: a thumb up, a finished task, the person's pick, simply carrying on", () => {
    for (const s of ["thumbs_up", "task_done", "chose_better", "carried_on"] as const)
      expect(resolveOutcome([s]).outcome).toBe("good");
  });

  test("a thumb up followed by a correction is bad: the correction is the later word", () => {
    expect(resolveOutcome(["thumbs_up", "corrected"])).toMatchObject({
      outcome: "bad",
      weight: -1,
    });
  });

  test("Send now and a restart are never a complaint: neutral whatever else is on record", () => {
    expect(resolveOutcome(["send_now", "stopped", "corrected"])).toEqual({
      outcome: "neutral",
      weight: 0,
      signals: ["send_now"],
    });
    expect(resolveOutcome(["interrupted", "thumbs_down"])).toEqual({
      outcome: "neutral",
      weight: 0,
      signals: ["interrupted"],
    });
  });
});

describe("looksLikeCorrection (moved out of the skill review, same words)", () => {
  test("English and Portuguese corrections, and nothing else", () => {
    for (const t of [
      "No, use the CSV",
      "Actually, sort by date",
      "não, o outro",
      "Sempre em tabela",
    ])
      expect(looksLikeCorrection(t)).toBe(true);
    for (const t of ["Thanks, now the second one", "Export the sales table", "ótimo, continue"])
      expect(looksLikeCorrection(t)).toBe(false);
  });
});

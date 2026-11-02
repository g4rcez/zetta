import { describe, expect, test } from "bun:test";
import { createAttention, levelOf } from "./attention";

const laya = (score: unknown, confidence: unknown, state = "ready", delay = 0) => ({
  calls: [] as string[],
  status: () => ({ state, model: "laya" as const }),
  async decide(text: string) {
    this.calls.push(text);
    if (delay) await Bun.sleep(delay);
    return { answers: { attention: { score, answer_confidence: confidence } } } as never;
  },
});

describe("attention level", () => {
  test("levels from literal scores", () => {
    expect(levelOf(0.2, 0.9)).toBe("trivial");
    expect(levelOf(0.2, 0.6)).toBe("normal");
    expect(levelOf(1.5, 0.95)).toBe("normal");
    expect(levelOf(2.7, 0.8)).toBe("complex");
    expect(levelOf(2.7, 0.3)).toBe("normal");
  });
  test("a greeting is trivial", async () => {
    const r = await createAttention(laya(0.1, 0.92) as never).assess("thanks!", "user-1");
    expect(r?.level).toBe("trivial");
    expect(r?.score).toBe(0.1);
    expect(r?.confidence).toBe(0.92);
  });
  test("a large task is complex", async () => {
    expect(
      (
        await createAttention(laya(2.9, 0.8) as never).assess(
          "migrate the billing system",
          "user-1",
        )
      )?.level,
    ).toBe("complex");
  });
  test("no result when Laya is off, loading or missing, and it never calls the model", async () => {
    for (const state of ["off", "idle", "loading", "failed"]) {
      const model = laya(0.1, 0.9, state);
      expect(await createAttention(model as never).assess("hi", "user-1")).toBeUndefined();
      expect(model.calls).toEqual([]);
    }
    expect(await createAttention(undefined).assess("hi", "user-1")).toBeUndefined();
  });
  test("no result for a malformed answer or a slow model", async () => {
    expect(
      await createAttention(laya("high", 0.9) as never).assess("hi", "user-1"),
    ).toBeUndefined();
    expect(
      await createAttention(laya(0.1, Number.NaN) as never).assess("hi", "user-1"),
    ).toBeUndefined();
    expect(
      await createAttention(laya(0.1, 0.9, "ready", 200) as never, 30).assess("hi", "user-1"),
    ).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";

import { elapsed, planProgress, planStates, stepStates } from "./work-timeline";

describe("stepStates", () => {
  test("the last step runs while the bot works", () => {
    expect(stepStates(3, true, "running")).toEqual(["done", "done", "running"]);
  });

  test("a finished reply has every step done", () => {
    expect(stepStates(2, false, "complete")).toEqual(["done", "done"]);
  });

  test("a failed or interrupted reply marks the last step failed", () => {
    expect(stepStates(2, false, "failed")).toEqual(["done", "failed"]);
    expect(stepStates(2, false, "interrupted")).toEqual(["done", "failed"]);
  });

  test("a stopped reply is not a failure", () => {
    expect(stepStates(2, false, "cancelled")).toEqual(["done", "done"]);
  });
});

describe("elapsed", () => {
  test("shows seconds under a minute and minutes with padded seconds after", () => {
    expect(elapsed(8_000)).toBe("8s");
    expect(elapsed(134_000)).toBe("2m 14s");
    expect(elapsed(61_000)).toBe("1m 01s");
  });

  test("never goes negative", () => {
    expect(elapsed(-5_000)).toBe("0s");
  });
});

describe("planStates", () => {
  const plan = [
    { id: "1", title: "Read", status: "done" },
    { id: "2", title: "Chart", status: "active" },
    { id: "3", title: "Write", status: "pending" },
  ] as const;
  test("while the bot works, the active step runs and the rest keep their state", () => {
    expect(planStates([...plan], true, "running")).toEqual(["done", "running", "pending"]);
  });
  test("a complete reply shows the active step as done (the bot may forget the last update)", () => {
    expect(planStates([...plan], false, "complete")).toEqual(["done", "done", "pending"]);
  });
  test("a failed or interrupted reply marks the active step failed", () => {
    expect(planStates([...plan], false, "failed")).toEqual(["done", "failed", "pending"]);
    expect(planStates([...plan], false, "interrupted")).toEqual(["done", "failed", "pending"]);
  });
  test("a stopped reply leaves the active step not started", () => {
    expect(planStates([...plan], false, "cancelled")).toEqual(["done", "pending", "pending"]);
  });
});

describe("planProgress", () => {
  test("names the first step that is not done", () => {
    expect(
      planProgress([
        { id: "1", title: "A", status: "done" },
        { id: "2", title: "B", status: "active" },
        { id: "3", title: "C", status: "pending" },
      ]),
    ).toBe("Step 2 of 3");
  });
  test("stays on the last step when every step is done", () => {
    expect(
      planProgress([
        { id: "1", title: "A", status: "done" },
        { id: "2", title: "B", status: "done" },
      ]),
    ).toBe("Step 2 of 2");
  });
});

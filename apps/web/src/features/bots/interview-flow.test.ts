import { describe, expect, test } from "bun:test";
import { briefFromTurns, nextTemplateStep } from "./interview-flow";

describe("basic (template) interview", () => {
  test("starts with the job question", () => {
    expect(nextTemplateStep([])).toMatchObject({
      done: false,
      question: "What is its job, in one sentence?",
    });
  });

  test("maps the five answers onto the template in order", () => {
    const turns = [
      { question: "a", answer: "Write release notes" },
      { question: "b", answer: "Read PRs" },
      { question: "c", answer: "A short list" },
      { question: "d", answer: "Leak tickets" },
      { question: "e", answer: "A PR is empty" },
    ];
    expect(briefFromTurns(turns)).toEqual({
      job: "Write release notes",
      steps: "Read PRs",
      output: "A short list",
      never: "Leak tickets",
      ask: "A PR is empty",
    });
    const step = nextTemplateStep(turns);
    expect(step.done).toBe(true);
    if (step.done) expect(step.instructions).toContain("Write release notes");
  });
});

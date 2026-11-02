import { describe, expect, test } from "bun:test";
import {
  briefFromTurns,
  FRESH_INTERVIEW,
  interviewLines,
  nextTemplateStep,
  READY_ENGINE,
  STARTED,
  turnsForTemplate,
  UPDATED,
} from "./interview-flow";

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

describe("falling back to the template after the engine fails", () => {
  test("keeps the first answer as the job and asks the second question next", () => {
    const kept = turnsForTemplate([
      { question: "What is this bot for?", answer: "Write release notes" },
    ]);
    expect(kept).toEqual([
      { question: "What is its job, in one sentence?", answer: "Write release notes" },
    ]);
    expect(nextTemplateStep(kept)).toMatchObject({
      done: false,
      question: "What should it do, step by step? (one per line)",
    });
  });

  test("drops answers to engine questions that the template does not ask", () => {
    const kept = turnsForTemplate([
      { question: "What is this bot for?", answer: "Write release notes" },
      { question: "Which repos?", answer: "All of them" },
    ]);
    expect(kept).toEqual([
      { question: "What is its job, in one sentence?", answer: "Write release notes" },
    ]);
  });

  test("keeps nothing when nothing was answered", () => {
    expect(turnsForTemplate([])).toEqual([]);
  });
});

describe("chat lines", () => {
  test("a draft that came from a template starts with the bot, then the person's description, then a pending reply", () => {
    const lines = interviewLines(
      {
        ...FRESH_INTERVIEW,
        status: "thinking",
        changes: [{ ask: "Você é o meu assistente de bartender", reply: null }],
      },
      true,
    );
    expect(lines).toEqual([
      { role: "assistant", content: STARTED },
      { role: "user", content: "Você é o meu assistente de bartender" },
      { role: "assistant", content: "", streaming: true },
    ]);
  });

  test("the bot answers a change once the draft is updated", () => {
    const lines = interviewLines(
      {
        ...FRESH_INTERVIEW,
        turns: [{ question: "What is this bot for?", answer: "Release notes" }],
        drafted: true,
        changes: [{ ask: "Make it formal", reply: UPDATED }],
      },
      true,
    );
    expect(lines).toEqual([
      { role: "assistant", content: "What is this bot for?" },
      { role: "user", content: "Release notes" },
      { role: "assistant", content: READY_ENGINE },
      { role: "user", content: "Make it formal" },
      { role: "assistant", content: UPDATED },
    ]);
  });

  test("a blank bot shows only the opening question", () => {
    const lines = interviewLines(
      { ...FRESH_INTERVIEW, current: { question: "What is this bot for?", suggestions: [] } },
      false,
    );
    expect(lines).toEqual([{ role: "assistant", content: "What is this bot for?" }]);
  });
});

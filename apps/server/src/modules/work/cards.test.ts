import { describe, expect, test } from "bun:test";
import { INTERNAL_WORDS } from "@zetta/core/work-suggestions";
import {
  blockedText,
  checkinText,
  nudgeText,
  plainStop,
  stepLine,
  stuckText,
  workKey,
} from "./cards";
import type { TaskFacts } from "./facts";

const facts = (over: Partial<TaskFacts> = {}, task: object = {}): TaskFacts =>
  ({
    task: { id: "t1", title: "Launch email", progress: "", ...task },
    stepsDone: 2,
    stepsTotal: 5,
    worker: { kind: "bot", id: "b1", name: "Dev Bot" },
    ownerName: "Allan",
    project: null,
    ...over,
  }) as TaskFacts;
const ana = { worker: { kind: "person" as const, id: "u1", name: "Ana" } };

describe("the words of a work card", () => {
  test("why a bot stopped is said in a manager's words", () => {
    expect(plainStop("no progress recorded in the last 3 follow-ups")).toBe(
      "It tried 3 times and nothing changed.",
    );
    expect(plainStop("40 follow-ups and the task is still open. Resume to give it 40 more.")).toBe(
      "It came back to the task 40 times without finishing it.",
    );
    expect(plainStop("failed 4 times in a row: the engine is over its usage limit")).toBe(
      "It failed 4 times in a row: The engine is over its usage limit.",
    );
    expect(plainStop("the room is closed")).toBe("The room it was working in was closed.");
    expect(plainStop("sign in to Claude again")).toBe("Sign in to Claude again.");
    expect(plainStop("")).toBe("");
  });
  test("the step a task was on, when it has steps left", () => {
    expect(stepLine({ stepsDone: 2, stepsTotal: 5 })).toBe("It was on step 3 of 5.");
    expect(stepLine({ stepsDone: 5, stepsTotal: 5 })).toBe("");
    expect(stepLine({ stepsDone: 0, stepsTotal: 0 })).toBe("");
  });
  test("a stopped bot", () => {
    expect(
      stuckText(facts(), {
        kind: "stopped",
        reason: "no progress recorded in the last 3 follow-ups",
      }),
    ).toEqual({
      title: "Dev Bot stopped on “Launch email”",
      detail: "It was on step 3 of 5. It tried 3 times and nothing changed.",
    });
    expect(stuckText(facts(), { kind: "idle" }).title).toBe("Dev Bot has not moved “Launch email”");
  });
  test("a person who did not answer", () => {
    expect(stuckText(facts(ana), { kind: "unanswered" }).title).toBe(
      "Ana has not answered about “Launch email”",
    );
    expect(stuckText(facts(ana), { kind: "no_reply" }).detail).toContain(
      "did not answer when asked",
    );
  });
  test("blocked work says what is in the way, or that nobody said", () => {
    expect(blockedText(facts(ana, { progress: "waiting for the legal text" }))).toEqual({
      title: "Ana is blocked on “Launch email”",
      detail: "waiting for the legal text",
    });
    expect(blockedText(facts(ana)).detail).toBe("They did not say what is in the way.");
  });
  test("what a person is asked, and a manager's message", () => {
    expect(checkinText(facts(ana)).title).toBe("Still working on “Launch email”?");
    expect(checkinText(facts(ana)).detail).toContain("Allan only hears about it if");
    expect(nudgeText(facts(ana), "Any news?")).toEqual({
      title: "Allan about “Launch email”",
      detail: "Any news?",
    });
  });
  test("no card uses a word of the code", () => {
    const all = [
      stuckText(facts(), {
        kind: "stopped",
        reason: "no progress recorded in the last 3 follow-ups",
      }),
      stuckText(facts(), {
        kind: "stopped",
        reason: "40 follow-ups and the task is still open. Resume to give it 40 more.",
      }),
      stuckText(facts(), { kind: "idle" }),
      stuckText(facts(ana), { kind: "unanswered" }),
      stuckText(facts(ana), { kind: "no_reply" }),
      blockedText(facts(ana)),
      checkinText(facts(ana)),
    ];
    for (const card of all) expect(`${card.title} ${card.detail}`).not.toMatch(INTERNAL_WORDS);
  });
  test("one live card per task and kind; a stopped task keeps the key the board already closes", () => {
    expect(workKey("work_stuck", "t1")).toBe("task-follow:t1");
    expect(workKey("work_blocked", "t1")).toBe("work-blocked:t1");
    expect(workKey("work_checkin", "t1")).toBe("work-checkin:t1");
  });
});

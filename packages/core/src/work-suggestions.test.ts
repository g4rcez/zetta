import { describe, expect, test } from "bun:test";
import {
  ALLOWED_WORK_ACTIONS,
  defaultWorkOptions,
  INTERNAL_WORDS,
  WORK_ACTIONS,
  WORK_CARD_KINDS,
  WORK_OPTIONS_MAX,
  workOption,
  type WorkSubject,
} from "./work-suggestions";

const bot: WorkSubject = { worker: { kind: "bot", id: "b", name: "Dev Bot" } };
const person: WorkSubject = { worker: { kind: "person", id: "u", name: "Ana Lima" } };
const asked: WorkSubject = { ...person, managerName: "Allan G" };

describe("work card options", () => {
  test("a stopped bot can be told, restarted, replaced or left alone", () => {
    expect(defaultWorkOptions("work_stuck", bot).map((o) => o.label)).toEqual([
      "Tell it what to do",
      "Ask it to continue",
      "Give it to someone else",
      "Give it more time",
    ]);
  });
  test("a person is told by name and never restarted", () => {
    const options = defaultWorkOptions("work_stuck", person);
    expect(options.map((o) => o.label)).toEqual([
      "Tell Ana",
      "Give it to someone else",
      "Give it more time",
    ]);
    expect(options[0]!.effect).toBe(
      "Your message goes to Ana's Inbox. The answer comes back to you.",
    );
  });
  test("the person asked answers with one tap, or says what is in the way", () => {
    expect(defaultWorkOptions("work_checkin", asked).map((o) => [o.label, o.input])).toEqual([
      ["Yes, on it", "none"],
      ["I'm blocked", "text"],
      ["It's done", "none"],
    ]);
    expect(defaultWorkOptions("work_nudge", asked)[0]).toMatchObject({
      label: "Reply",
      effect: "Your answer goes to Allan.",
      input: "text",
    });
  });
  test("a card never has more buttons than fit, and only actions its kind accepts", () => {
    for (const kind of WORK_CARD_KINDS)
      for (const subject of [bot, person, asked]) {
        const options = defaultWorkOptions(kind, subject);
        expect(options.length).toBeLessThanOrEqual(WORK_OPTIONS_MAX);
        expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
        for (const o of options) expect(ALLOWED_WORK_ACTIONS[kind]).toContain(o.action);
      }
  });
  test("every button says what it does, in words a manager uses", () => {
    for (const action of WORK_ACTIONS)
      for (const subject of [bot, person, asked, { worker: null }]) {
        const o = workOption(action, subject);
        expect(o.label.length).toBeGreaterThan(2);
        expect(o.effect.endsWith(".")).toBe(true);
        expect(`${o.label} ${o.effect}`).not.toMatch(INTERNAL_WORDS);
      }
  });
  test("only deleting a task waits for an undo", () => {
    expect(WORK_ACTIONS.filter((a) => workOption(a, bot).risk === "undoable")).toEqual(["drop"]);
  });
});

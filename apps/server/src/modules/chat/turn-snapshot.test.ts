import { describe, expect, test } from "bun:test";

import type { ChatEvent } from "./service";
import { answersOf, slowDetail } from "./turn-snapshot";

const ev = (e: unknown) => e as ChatEvent;

describe("answersOf", () => {
  test("an answer that started and did not finish shows its step and earlier steps", () => {
    const events = [
      ev({ type: "start", messageId: "m1", botId: "b1", botName: "tester" }),
      ev({ type: "activity", messageId: "m1", botId: "b1", label: "Thinking", at: 1000 }),
      ev({ type: "activity", messageId: "m1", botId: "b1", label: "wiki search", at: 2000 }),
      ev({ type: "activity", messageId: "m1", botId: "b1", label: "Thinking", at: 3000 }),
    ];
    expect(answersOf(events)).toEqual([
      {
        messageId: "m1",
        botId: "b1",
        botName: "tester",
        step: "Thinking",
        stepSince: 3000,
        timeline: [{ at: 2000, label: "wiki search" }],
      },
    ]);
  });
  test("a finished answer is not listed", () => {
    const events = [
      ev({ type: "start", messageId: "m1", botId: "b1", botName: "tester" }),
      ev({ type: "message", botName: "tester", message: { id: "m1" } }),
    ];
    expect(answersOf(events)).toEqual([]);
  });
  test("the plan reports done steps and the active one", () => {
    const events = [
      ev({ type: "start", messageId: "m1", botId: "b1", botName: "tester" }),
      ev({
        type: "plan",
        messageId: "m1",
        botId: "b1",
        steps: [
          { id: "a", title: "Read", status: "done" },
          { id: "b", title: "Fix", status: "active" },
          { id: "c", title: "Test", status: "pending" },
        ],
      }),
    ];
    expect(answersOf(events)[0]!.plan).toEqual({ done: 1, total: 3, active: "Fix" });
  });
});

describe("slowDetail", () => {
  const base = { messageId: "m1", botId: "b1", botName: "tester", timeline: [] };
  test("names the bot, its step and the commands it runs", () => {
    const text = slowDetail(
      11,
      [
        {
          ...base,
          step: "Thinking",
          stepSince: 0,
          processes: [
            { pid: 10, command: "claude" },
            { pid: 11, command: "sleep 900" },
          ],
        },
      ],
      11 * 60_000,
    );
    expect(text).toBe(
      "No new output for 11 min. tester: Thinking for 11 min. Running: sleep 900 (PID 11).",
    );
  });
  test("says when the CLI has no child process", () => {
    const text = slowDetail(
      11,
      [{ ...base, step: "Thinking", processes: [{ pid: 10, command: "claude" }] }],
      0,
    );
    expect(text).toBe(
      "No new output for 11 min. tester: Thinking. No child process: the CLI waits on its model.",
    );
  });
});

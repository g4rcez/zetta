import { describe, expect, test } from "bun:test";

import { goalPrompt } from "../features/routines";
import { runMyRoutine } from "./my-routine";

const actor = { userId: "u1" } as never;
const bot = { id: "b1", name: "Digest" };
function fake(mode: "task" | "goal") {
  const paused: string[] = [];
  const routines = {
    list: async () => [
      {
        id: "r1",
        botId: "b1",
        title: "Grow the newsletter",
        paused: false,
        status: "scheduled",
        nextRunAt: null,
        mode,
      },
    ],
    setPaused: async (_a: unknown, id: string, on: boolean) => void (on && paused.push(id)),
  };
  return { routines: routines as never, paused };
}

describe("standing goals", () => {
  test("the bot cannot pause its own standing goal; only the person can", async () => {
    const { routines, paused } = fake("goal");
    const r = await runMyRoutine(routines, actor, bot, { action: "pause", id: "r1" });
    expect(paused).toEqual([]);
    expect(r.result).toContain("refused");
    expect(r.note).toContain("only you can pause it");
  });

  test("a task routine still pauses when the bot asks", async () => {
    const { routines, paused } = fake("task");
    await runMyRoutine(routines, actor, bot, { action: "pause", id: "r1" });
    expect(paused).toEqual(["r1"]);
  });

  test("each goal run gets the goal and the last run's report, framed as notes", () => {
    const first = goalPrompt("Reach 1,000 subscribers", undefined);
    expect(first).toContain("Standing goal");
    expect(first).toContain("Reach 1,000 subscribers");
    expect(first).toContain("first run toward this goal");
    const next = goalPrompt(
      "Reach 1,000 subscribers",
      "Done: wrote 2 posts.\nNext: share on forums.",
    );
    expect(next).toContain("Where the last run left it");
    expect(next).toContain("Next: share on forums.");
    expect(next).toContain("Do not pause, stop or archive this routine yourself.");
  });

  test("a long report keeps only its end, where Status and Next are", () => {
    const p = goalPrompt("g", `${"x".repeat(9000)}\nNext: the end`);
    expect(p).toContain("Next: the end");
    expect(p.length).toBeLessThan(5000);
  });
});

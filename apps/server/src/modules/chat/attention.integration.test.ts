import { uuidv7 } from "@zetta/core/uuid";
import { describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import type { MemoryHit } from "../memory/service";
import { createAttention } from "./attention";
import { createTurnRunner, type Used } from "./pipeline";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const page: MemoryHit = {
  slug: "refunds",
  title: "Refunds",
  type: "owner",
  howto: "How refunds work",
  tags: [],
  score: 50,
  status: "current",
  access: "own",
  ownerName: null,
  neighbors: [],
};

/** Laya is the only fake (an external model). Everything else is the real turn runner reading the real database. */
function turn(laya: { state: string; score?: number; confidence?: number }) {
  const prompts: string[] = [];
  const searched = { memory: 0 };
  const decisions = {
    status: () => ({ state: laya.state, model: "laya" as const }),
    decide: async () =>
      ({
        answers: { attention: { score: laya.score, answer_confidence: laya.confidence } },
      }) as never,
  };
  const runner = createTurnRunner(
    createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never),
    (async (input: { prompt: string }) => {
      prompts.push(input.prompt);
      return "ok";
    }) as never,
    undefined,
    { search: async () => (searched.memory++, [page]) },
    createAttention(decisions as never),
  );
  const userId = `attention-${uuidv7()}`;
  const bot = {
    id: uuidv7(),
    ownerUserId: userId,
    kind: "specialist",
    name: "Helper",
    harness: "codex",
    model: null,
    personality: "",
    instructions: "",
    computerMode: "off",
    codeAccess: false,
  } as never;
  return {
    prompts,
    searched,
    async ask(prompt: string) {
      let used: Used | undefined;
      await runner({ userId, bot, history: [], prompt, onUsed: (u) => void (used = u) });
      return { prompt: prompts.at(-1) ?? "", used };
    },
  };
}

suite("Laya attention in a chat turn (real database)", () => {
  test("a greeting gets no memory items", async () => {
    const t = turn({ state: "ready", score: 0.1, confidence: 0.92 });
    const { prompt, used } = await t.ask("thanks!");
    expect(prompt).not.toContain("Memory items that may help");
    expect(t.searched).toEqual({ memory: 0 });
    expect(used?.attention?.level).toBe("trivial");
  });
  test("a normal request keeps the memory items", async () => {
    const t = turn({ state: "ready", score: 1.4, confidence: 0.8 });
    const { prompt, used } = await t.ask("how long do refunds take?");
    expect(prompt).toContain("Memory items that may help");
    expect(prompt).not.toContain("looks complex");
    expect(used?.attention?.level).toBe("normal");
  });
  test("a complex request asks the bot to plan and verify", async () => {
    const t = turn({ state: "ready", score: 2.9, confidence: 0.8 });
    const { prompt, used } = await t.ask("rebuild the billing reports for every client");
    expect(prompt).toContain("This request looks complex: start with a zetta:plan");
    expect(used?.attention?.level).toBe("complex");
  });
  test("Laya off: the turn is the same as before and records no attention", async () => {
    const t = turn({ state: "off" });
    const { prompt, used } = await t.ask("thanks!");
    expect(prompt).not.toContain("looks complex");
    expect(used?.attention).toBeUndefined();
  });
});

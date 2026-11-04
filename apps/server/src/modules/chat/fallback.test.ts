import { describe, expect, test } from "bun:test";
import type { bot } from "@zetta/db/schema/chat";
import { HarnessError } from "./harness";
import { runWithFallback, streamWithFallback } from "./fallback";

type Bot = typeof bot.$inferSelect;
const mainBot = (extra: Partial<Bot> = {}) =>
  ({
    harness: "claude-code",
    model: "opus",
    fallbackHarness: "deepseek",
    fallbackModel: null,
    ...extra,
  }) as Bot;

/** One fake run per harness: a reply, or the error it ends with. */
const fake = (outcomes: Record<string, string | HarnessError>, seen: string[] = []) =>
  async function* (b: Bot) {
    seen.push(b.harness);
    const out = outcomes[b.harness]!;
    if (out instanceof HarnessError) throw out;
    yield out;
  };
const collect = async (g: AsyncGenerator<unknown>) => {
  const out: unknown[] = [];
  for await (const x of g) out.push(x);
  return out;
};

describe("streamWithFallback", () => {
  test("a main harness at its usage limit hands the turn to the fallback and says so", async () => {
    const seen: string[] = [];
    const uses: unknown[] = [];
    const out = await collect(
      streamWithFallback(
        mainBot(),
        fake({ "claude-code": new HarnessError("quota"), deepseek: "from deepseek" }, seen),
        (u) => uses.push(u),
      ),
    );
    expect(out).toEqual([
      { activity: "Claude Code has reached its usage limit · answering with DeepSeek" },
      "from deepseek",
    ]);
    expect(seen).toEqual(["claude-code", "deepseek"]);
    expect(uses).toEqual([{ from: "claude-code", to: "deepseek", reason: "quota" }]);
  });

  test("a harness that is not signed in or not installed also moves to the fallback", async () => {
    for (const code of ["auth_required", "not_installed"] as const) {
      const out = await collect(
        streamWithFallback(
          mainBot(),
          fake({ "claude-code": new HarnessError(code), deepseek: "ok" }),
        ),
      );
      expect(out.at(-1)).toBe("ok");
    }
  });

  test("a timeout is not a block: the error stays and the fallback is not used", async () => {
    const seen: string[] = [];
    const run = collect(
      streamWithFallback(
        mainBot(),
        fake({ "claude-code": new HarnessError("timeout"), deepseek: "ok" }, seen),
      ),
    );
    await expect(run).rejects.toMatchObject({ code: "timeout" });
    expect(seen).toEqual(["claude-code"]);
  });

  test("a bot with no fallback keeps the original error", async () => {
    const run = collect(
      streamWithFallback(
        mainBot({ fallbackHarness: null }),
        fake({ "claude-code": new HarnessError("quota") }),
      ),
    );
    await expect(run).rejects.toMatchObject({ code: "quota" });
  });

  test("once part of the reply was sent, a later block is not answered a second time", async () => {
    async function* halfway(): AsyncGenerator<string, void> {
      yield "partial ";
      throw new HarnessError("quota");
    }
    const run = collect(streamWithFallback(mainBot(), halfway));
    await expect(run).rejects.toMatchObject({ code: "quota" });
  });

  test("the fallback is tried once: its own block is thrown", async () => {
    const run = collect(
      streamWithFallback(
        mainBot(),
        fake({
          "claude-code": new HarnessError("quota"),
          deepseek: new HarnessError("auth_required"),
        }),
      ),
    );
    await expect(run).rejects.toMatchObject({ code: "auth_required" });
  });

  test("the fallback runs with its own model, not the main one", async () => {
    const models: (string | null)[] = [];
    const start = async function* (b: Bot) {
      models.push(b.model);
      if (b.harness === "claude-code") throw new HarnessError("quota");
      yield "ok";
    };
    await collect(streamWithFallback(mainBot({ fallbackModel: "m2" }), start));
    expect(models).toEqual(["opus", "m2"]);
  });
});

describe("runWithFallback", () => {
  test("moves to the fallback on a block and returns its answer", async () => {
    const answer = await runWithFallback(mainBot(), async (b) => {
      if (b.harness === "claude-code") throw new HarnessError("quota");
      return `answered by ${b.harness}`;
    });
    expect(answer).toBe("answered by deepseek");
  });

  test("keeps any other failure", async () => {
    const run = runWithFallback(mainBot(), async () => {
      throw new HarnessError("failed");
    });
    await expect(run).rejects.toMatchObject({ code: "failed" });
  });
});

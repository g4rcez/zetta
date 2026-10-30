import { describe, expect, test } from "bun:test";
import { createLocalEmbedder } from "./embed";

// Loads the real model (about 120 MB, downloaded once). Off by default: ZETTA_EMBEDDING_SMOKE=1 [ZETTA_EMBEDDING_MODEL_DIR=<cache>].
const smoke = process.env.ZETTA_EMBEDDING_SMOKE === "1" ? describe : describe.skip;

smoke("local embedding model", () => {
  test("gives 384-dimension unit vectors, and related text in two languages is close", async () => {
    const e = createLocalEmbedder();
    const [q] = await e.embed(["orçamento do projeto"], "query");
    const [near, far] = await e.embed(
      ["The budget of the project is approved.", "Grilled cheese sandwich recipe with tomato."],
      "passage",
    );
    const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(q).toHaveLength(384);
    expect(cos(q!, q!)).toBeCloseTo(1, 3);
    expect(cos(q!, near!)).toBeGreaterThan(cos(q!, far!) + 0.03);
    expect(cos(q!, near!)).toBeGreaterThan(0.85);
  }, 120_000);
});

describe("embedding queue", () => {
  // A fake model that takes 40 ms per batch and records the order of the texts it saw.
  const order: string[] = [];
  const extractor = async (texts: string[]) => {
    await Bun.sleep(40);
    order.push(texts[0]!);
    return texts.map(() => [1]);
  };

  test("a query waits for one batch, not for the whole passage backlog", async () => {
    const e = createLocalEmbedder({ extractor });
    const bulk = Array.from({ length: 40 }, (_, i) => `p${i}`); // 5 batches of 8
    const backlog = e.embed(bulk, "passage");
    await Bun.sleep(10); // the first passage batch is running
    const t = performance.now();
    await e.embed(["where is the budget"], "query");
    const waited = performance.now() - t;
    await backlog;
    expect(order.indexOf("query: where is the budget")).toBe(1); // right after the running batch
    expect(waited).toBeLessThan(150); // 5 batches in a row would take 200 ms
  });

  test("a query that timed out before its turn is dropped", async () => {
    order.length = 0;
    const e = createLocalEmbedder({ extractor });
    const backlog = e.embed(
      Array.from({ length: 16 }, (_, i) => `p${i}`),
      "passage",
    );
    await Bun.sleep(10);
    const ctl = new AbortController();
    const late = e.embed(["too late"], "query", { signal: ctl.signal });
    ctl.abort(new Error("slow"));
    await expect(late).rejects.toThrow("slow");
    await backlog;
    expect(order).not.toContain("query: too late");
  });
});

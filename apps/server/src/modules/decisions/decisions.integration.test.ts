import { uuidv7 } from "@zetta/core/uuid";
import { describe, expect, test } from "bun:test";
import { createDecisionService, DecisionError } from "./service";
import { executeGraph, graphSchema } from "../features/workflow";

describe("decision service (fake model)", () => {
  test("serializes calls, reports status and recovers from a failed load", async () => {
    let loads = 0,
      active = 0,
      peak = 0;
    const svc = createDecisionService(
      async () => {
        if (++loads === 1) throw new Error("boom");
        return {
          systemOne: async () => {
            peak = Math.max(peak, ++active);
            await Bun.sleep(10);
            active--;
            return { answers: { pick: { choice: "a", probabilities: { a: 1 } } } } as never;
          },
          close: async () => {},
        };
      },
      undefined,
      { mode: "on" },
    );
    expect(svc.status().state).toBe("idle");
    await expect(svc.decide("x", { q: { type: "noul", instructions: "?" } })).rejects.toThrow();
    expect(svc.status().state).toBe("failed");
    await Promise.all([
      svc.choose("s", "?", ["a", "b"]),
      svc.choose("s", "?", ["a", "b"]),
      svc.choose("s", "?", ["a", "b"]),
    ]);
    expect(svc.status().state).toBe("ready");
    expect(peak).toBe(1);
  });
  test("workflow decision node routes by the chosen option and fails closed", async () => {
    const graph = graphSchema.parse({
      start: "d",
      nodes: {
        d: { type: "decision", question: "Which?", choices: { billing: "b", support: "s" } },
        b: { type: "end" },
        s: { type: "end" },
      },
    });
    const ok = await executeGraph(
      graph,
      "refund please",
      async () => "",
      async () => "billing",
    );
    expect(ok.trace.map((t) => t.node)).toEqual(["d", "b"]);
    expect(
      (
        await executeGraph(
          graph,
          "x",
          async () => "",
          async () => "nonsense",
        )
      ).status,
    ).toBe("failed");
    expect((await executeGraph(graph, "x", async () => "")).status).toBe("failed");
  });
});

describe("decision hardening", () => {
  const model =
    (answer: unknown, delay = 0) =>
    async () => ({
      systemOne: async () => {
        if (delay) await Bun.sleep(delay);
        return { answers: { pick: answer } } as never;
      },
      close: async () => {},
    });
  test("rejects invalid output: unknown choice, probabilities that do not sum to 1, foreign keys", async () => {
    for (const bad of [
      { choice: "z", probabilities: { a: 1 } },
      { choice: "a", probabilities: { a: 0.3, b: 0.3 } },
      { choice: "a", probabilities: { a: 0.5, q: 0.5 } },
      { choice: 5, probabilities: { a: 1 } },
      undefined,
    ])
      expect(
        await createDecisionService(model(bad), undefined, { mode: "on" })
          .choose("s", "?", ["a", "b"])
          .then(
            () => "ok",
            (e) => (e as DecisionError).code,
          ),
      ).toBe("invalid_output");
  });
  test("below the confidence threshold the answer is uncertain, with provenance", async () => {
    const r = await createDecisionService(
      model({ choice: "a", probabilities: { a: 0.55, b: 0.45 } }),
      undefined,
      { mode: "on" },
    ).choose("s", "?", ["a", "b"], { minConfidence: 0.7 });
    expect(r).toMatchObject({ choice: null, uncertain: true, confidence: 0.55 });
    expect(r.provenance.model).toBe("laya");
  });
  test("a hung call times out, releases the queue and the next call reloads the model", async () => {
    let loads = 0;
    const svc = createDecisionService(
      async () => {
        loads++;
        return {
          systemOne: async () => {
            if (loads === 1) await Bun.sleep(500);
            return { answers: { pick: { choice: "a", probabilities: { a: 1 } } } } as never;
          },
          close: async () => {},
        };
      },
      80,
      { mode: "on" },
    );
    expect(
      await svc.choose("s", "?", ["a", "b"]).then(
        () => "ok",
        (e) => (e as DecisionError).code,
      ),
    ).toBe("timeout");
    expect((await svc.choose("s", "?", ["a", "b"])).choice).toBe("a");
    expect(loads).toBe(2);
  });
});

describe("workflow browse node", () => {
  test("feeds page text to the next step and fails closed without a browser", async () => {
    const graph = graphSchema.parse({
      start: "b",
      nodes: {
        b: { type: "browse", url: "https://example.com/{{input}}", next: "p" },
        p: { type: "prompt", botId: uuidv7(), template: "summarise {{prev}}", next: "e" },
        e: { type: "end" },
      },
    });
    const seen: string[] = [];
    const ok = await executeGraph(
      graph,
      "page1",
      async (_b, prompt) => {
        seen.push(prompt);
        return "summary";
      },
      undefined,
      async (url) => `TEXT of ${url}`,
    );
    expect(seen[0]).toBe("summarise TEXT of https://example.com/page1");
    expect(ok.status).toBe("succeeded");
    expect((await executeGraph(graph, "x", async () => "")).status).toBe("failed");
  });
});

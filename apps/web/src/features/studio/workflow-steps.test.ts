import { describe, expect, test } from "bun:test";

import { graphToSteps, stepsToGraph, type Step } from "./workflow-steps";

const steps: Step[] = [
  { kind: "browse", url: "https://example.com" },
  { kind: "prompt", botId: "b1", template: "{{prev}}" },
  { kind: "decision", question: "Which?", options: "yes, no", continueOn: "yes" },
  { kind: "condition", contains: "ok" },
];

describe("workflow steps", () => {
  test("builds a linear graph that ends at `end`, with a `stop` branch for gates", () => {
    const g = stepsToGraph(steps);
    expect(g.start).toBe("s0");
    expect(g.nodes.s3).toEqual({ type: "condition", contains: "ok", then: "end", else: "stop" });
    expect(g.nodes.s2).toEqual({ type: "decision", question: "Which?", choices: { yes: "s3", no: "stop" } });
    expect(g.nodes.stop).toEqual({ type: "end" });
  });
  test("no stop node when nothing can stop", () => {
    expect(stepsToGraph([{ kind: "prompt", botId: "b", template: "x" }]).nodes.stop).toBeUndefined();
  });
  test("round-trips", () => expect(graphToSteps(stepsToGraph(steps))).toEqual(steps));
  test("returns null for graphs the builder cannot express", () => {
    expect(graphToSteps({ start: "a", nodes: { a: { type: "prompt", botId: "b", template: "x", next: "z" }, z: { type: "end" } } })).toBeNull();
    expect(graphToSteps({ start: "s0", nodes: { s0: { type: "decision", question: "q", choices: { a: "end", b: "end" } }, end: { type: "end" } } })).toBeNull();
    expect(graphToSteps(null)).toBeNull();
    expect(graphToSteps({ start: "s0", nodes: { s0: { type: "end" } } })).toBeNull();
  });
});

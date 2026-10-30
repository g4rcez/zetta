import { describe, expect, test } from "bun:test";
import {
  flowToGraph,
  graphToFlow,
  localProblems,
  newNode,
  type ServerGraph,
} from "./workflow-graph";

const g: ServerGraph = {
  start: "a",
  nodes: {
    a: { type: "sources", next: "b" },
    b: { type: "prompt", botId: "bot-1", template: "Summarize {{prev}}", next: "c" },
    // oxlint-disable-next-line unicorn/no-thenable
    c: { type: "condition", contains: "urgent", then: "d", else: "e" },
    d: { type: "decision", question: "Who?", choices: { billing: "e", support: "e" } },
    e: { type: "end" },
  },
};

describe("workflow canvas model", () => {
  test("round-trips the server graph through the canvas without loss", () => {
    const { nodes, edges } = graphToFlow(g);
    const back = flowToGraph(nodes, edges, "a");
    const { layout: _l, ...rest } = back;
    expect(rest).toEqual({ start: "a", nodes: g.nodes });
    expect(edges.map((e) => e.id).sort()).toEqual([
      "a:next",
      "b:next",
      "c:else",
      "c:then",
      "d:choice:billing",
      "d:choice:support",
    ]);
  });
  test("layout puts nodes in columns by depth and keeps saved positions", () => {
    const flow = graphToFlow(g);
    expect(flow.nodes.find((n) => n.id === "b")!.position.x).toBeGreaterThan(
      flow.nodes.find((n) => n.id === "a")!.position.x,
    );
    const saved = graphToFlow({ ...g, layout: { a: { x: 7, y: 9 } } });
    expect(saved.nodes.find((n) => n.id === "a")!.position).toEqual({ x: 7, y: 9 });
  });
  test("missing connections are reported before saving", () => {
    const n = [
      newNode("p", "prompt", { x: 0, y: 0 }),
      newNode("c", "condition", { x: 0, y: 0 }),
      newNode("e", "end", { x: 0, y: 0 }),
    ];
    const problems = localProblems(flowToGraph(n, [], "p"));
    expect(problems.join(" ")).toContain("needs a bot");
    expect(problems.join(" ")).toContain("both branches");
    expect(localProblems({ start: "x", nodes: {} })).toEqual(["Add at least one step."]);
    expect(localProblems({ start: "x", nodes: { a: { type: "sources" } } }).join(" ")).toContain(
      "Finish",
    );
  });
});

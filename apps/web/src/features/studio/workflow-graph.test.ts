import { describe, expect, test } from "bun:test";
import {
  flowToGraph,
  graphToFlow,
  handlesOf,
  hasRetry,
  localProblems,
  newNode,
  parseArgs,
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

describe("the new steps on the canvas", () => {
  const BOT = "bot-1";
  const v2: ServerGraph = {
    start: "src",
    nodes: {
      src: {
        type: "prompt",
        botId: BOT,
        template: "list",
        retry: { max: 2, delayMs: 500 },
        next: "ask",
      },
      ask: { type: "approval", message: "Go on?", next: "pause" },
      pause: { type: "wait", seconds: 3600, next: "each" },
      each: { type: "for_each", items: "lines", body: "look", max: 5, next: "done" },
      look: {
        type: "tool",
        botId: BOT,
        kind: "plugin",
        target: "gmail",
        tool: "gmail_search",
        args: { query: "{{item}}" },
        retry: { max: 1, delayMs: 1000 },
        next: "pass",
      },
      pass: { type: "item_end" },
      done: { type: "end" },
    },
  };
  test("every step comes back from the canvas as it went in, including retries and a loop's two outputs", () => {
    const { nodes, edges } = graphToFlow(v2);
    const { layout: _l, ...back } = flowToGraph(nodes, edges, "src");
    expect(back).toEqual({ start: "src", nodes: v2.nodes });
    expect(edges.map((e) => e.id).sort()).toEqual([
      "ask:next",
      "each:body",
      "each:next",
      "look:next",
      "pause:next",
      "src:next",
    ]);
  });
  test("a loop has an output for each item and one for what follows; an end of item has none", () => {
    expect(handlesOf({ kind: "for_each" })).toEqual(["body", "next"]);
    expect(handlesOf({ kind: "item_end" })).toEqual([]);
    expect(handlesOf({ kind: "approval" })).toEqual(["next"]);
    expect(handlesOf({ kind: "tool" })).toEqual(["next"]);
  });
  test("retries belong to the steps that can fail and are written only when asked for", () => {
    expect(
      hasRetry("prompt") && hasRetry("tool") && hasRetry("browse") && hasRetry("sources"),
    ).toBe(true);
    expect(
      hasRetry("approval") || hasRetry("wait") || hasRetry("for_each") || hasRetry("end"),
    ).toBe(false);
    const n = newNode("a", "prompt", { x: 0, y: 0 }, BOT);
    expect(flowToGraph([n], [], "a").nodes.a).toEqual({
      type: "prompt",
      botId: BOT,
      template: "{{prev}}",
    });
    n.data.retryMax = 5;
    n.data.retryDelayMs = 90_000;
    // At most 3 more tries, and the delay is kept as typed (the server holds the limit).
    expect(flowToGraph([n], [], "a").nodes.a).toMatchObject({ retry: { max: 3, delayMs: 90_000 } });
  });
  test("the arguments of a tool are read as a JSON object, and anything else is refused", () => {
    expect(parseArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseArgs("")).toEqual({});
    expect(parseArgs("[1]")).toBeUndefined();
    expect(parseArgs("{oops")).toBeUndefined();
    expect(parseArgs('"text"')).toBeUndefined();
  });
  test("a wait keeps either the seconds or the time", () => {
    const a = newNode("w", "wait", { x: 0, y: 0 });
    expect(flowToGraph([a], [], "w").nodes.w).toEqual({ type: "wait", seconds: 3600 });
    a.data.until = "2030-01-01T00:00:00Z";
    expect(flowToGraph([a], [], "w").nodes.w).toEqual({
      type: "wait",
      until: "2030-01-01T00:00:00Z",
    });
  });
  test("what is missing is said before saving", () => {
    const problems = localProblems({
      start: "t",
      nodes: {
        t: { type: "tool", botId: "", kind: "plugin", target: "", tool: "", next: "q" },
        q: { type: "approval", message: " ", next: "f" },
        f: { type: "for_each", items: "lines", body: "", next: "e" },
        e: { type: "end" },
      },
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        '"t" needs a bot.',
        '"t" needs the name of a tool and where it lives.',
        '"q" needs a question for you.',
        '"f" needs its "each item" output connected.',
      ]),
    );
  });
});

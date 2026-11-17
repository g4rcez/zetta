import { expect, test } from "bun:test";
import { workflowPairs } from "./links";

const A = "01a1ce15-0000-7000-8000-00000000000a";
const B = "01a1ce15-0000-7000-8000-00000000000b";
const C = "01a1ce15-0000-7000-8000-00000000000c";

test("bots that follow each other in a workflow are a pair, through steps that belong to no bot", () => {
  const pairs = workflowPairs({
    start: "a",
    nodes: {
      a: { type: "prompt", botId: A, template: "x", next: "w" },
      w: { type: "wait", seconds: 5, next: "d" },
      d: { type: "decision", question: "?", choices: { yes: "b", no: "c" } },
      b: { type: "tool", botId: B, kind: "plugin", target: "t", tool: "t", next: "e" },
      c: { type: "prompt", botId: C, template: "x", next: "e" },
      e: { type: "end" },
    },
  });
  expect(pairs).toEqual([
    [A, B],
    [A, C],
  ]);
});

test("a bot that follows itself, a loop and a broken graph make no pair and no crash", () => {
  expect(
    workflowPairs({
      nodes: {
        a: { type: "prompt", botId: A, template: "x", next: "b" },
        b: { type: "prompt", botId: A, template: "x", next: "a" },
      },
    }),
  ).toEqual([]);
  expect(workflowPairs(null)).toEqual([]);
  expect(workflowPairs({ nodes: "nope" })).toEqual([]);
  expect(workflowPairs({ nodes: { a: { type: "prompt", botId: A, next: "zzz" } } })).toEqual([]);
});

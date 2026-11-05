import { describe, expect, test } from "bun:test";

import { filterOf, parseMemorySearch } from "./memory-filters";
import {
  buildGraph,
  fromNeighbors,
  neighborhood,
  nodeSize,
  summary,
  type GraphData,
  type GraphNodeData,
} from "./memory-graph";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const node = (o: Partial<GraphNodeData>): GraphNodeData => ({
  id: "n",
  slug: "n",
  title: "N",
  type: "owner",
  tags: [],
  score: 50,
  status: "current",
  access: "own",
  inDegree: 0,
  outDegree: 0,
  updatedAt: "2026-11-01T00:00:00Z",
  ...o,
});
const data: GraphData = {
  nodes: [
    node({ id: "a", slug: "a", title: "A", tags: ["billing", "ops"], score: 90, outDegree: 1 }),
    node({ id: "b", slug: "b", title: "B", tags: ["billing"], inDegree: 1, outDegree: 1 }),
    node({ id: "c", slug: "c", title: "C", type: "solo", tags: ["x"], inDegree: 1 }),
    node({ id: "z", slug: "z", title: "Z" }),
  ],
  edges: [
    { from: "a", to: "b", relation: "depends-on" },
    { from: "b", to: "c", relation: "related" },
  ],
  dangling: [{ from: "a", to: "nope", relation: "related" }],
  truncated: false,
};
const filter = (s: Record<string, unknown> = {}) => filterOf(parseMemorySearch(s));

describe("buildGraph", () => {
  test("size grows with score and links; orphans are counted", () => {
    const g = buildGraph(data, { filter: filter(), colorBy: "type", showMissing: false, now: NOW });
    expect(g.nodes.find((n) => n.id === "a")!.size).toBeCloseTo(nodeSize(90, 1));
    expect(g.nodes.find((n) => n.id === "a")!.size).toBeGreaterThan(
      g.nodes.find((n) => n.id === "z")!.size,
    );
    expect(g.nodes.filter((n) => n.orphan).map((n) => n.id)).toEqual(["z"]);
    expect(g.orphans).toBe(1);
  });
  test("a node that does not match the filters is dimmed, not removed, and so are its links", () => {
    const g = buildGraph(data, {
      filter: filter({ tag: "billing" }),
      colorBy: "type",
      showMissing: false,
      now: NOW,
    });
    expect(g.nodes.map((n) => [n.id, n.dim])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
      ["z", true],
    ]);
    expect(g.links.map((l) => [l.source, l.target, l.dim])).toEqual([
      ["a", "b", false],
      ["b", "c", true],
    ]);
  });
  test("facets the graph has no data for (author, bot, team) do not dim anything", () => {
    const g = buildGraph(data, {
      filter: filter({ by: "bot" }),
      colorBy: "type",
      showMissing: false,
      now: NOW,
    });
    expect(g.nodes.every((n) => !n.dim)).toBe(true);
  });
  test("color by type groups by who reads the item and lists the legend in words", () => {
    const g = buildGraph(data, { filter: filter(), colorBy: "type", showMissing: false, now: NOW });
    expect(g.legend).toEqual([
      { group: "owner", label: "All my bots" },
      { group: "solo", label: "One bot" },
    ]);
  });
  test("color by tag gives the most used tags a group and the rest 'other'", () => {
    const many: GraphData = {
      ...data,
      nodes: [...data.nodes, node({ id: "d", tags: ["p"] }), node({ id: "e", tags: ["q"] })],
    };
    const g = buildGraph(many, { filter: filter(), colorBy: "tag", showMissing: false, now: NOW });
    expect(g.nodes.map((n) => [n.id, n.group])).toEqual([
      ["a", "billing"],
      ["b", "billing"],
      ["c", "other"],
      ["z", "other"],
      ["d", "p"],
      ["e", "other"], // billing, ops and p are the three most used (ties go by name)
    ]);
  });
  test("links to missing items show as faint nodes only when asked", () => {
    const off = buildGraph(data, {
      filter: filter(),
      colorBy: "type",
      showMissing: false,
      now: NOW,
    });
    expect(off.nodes.some((n) => n.missing)).toBe(false);
    const on = buildGraph(data, { filter: filter(), colorBy: "type", showMissing: true, now: NOW });
    expect(on.nodes.find((n) => n.missing)).toMatchObject({
      id: "missing:nope",
      slug: "nope",
      group: "missing",
    });
    expect(on.links.find((l) => l.missing)).toMatchObject({ source: "a", target: "missing:nope" });
    expect(on.legend.at(-1)).toEqual({ group: "missing", label: "Missing item" });
  });
  test("search hits are marked and the other nodes are dimmed", () => {
    const g = buildGraph(data, {
      filter: filter({ q: "refunds" }),
      colorBy: "type",
      showMissing: false,
      hits: new Set(["c"]),
      now: NOW,
    });
    expect(g.nodes.filter((n) => n.hit).map((n) => n.id)).toEqual(["c"]);
    expect(g.nodes.map((n) => [n.id, n.dim])).toEqual([
      ["a", true],
      ["b", true],
      ["c", false],
      ["z", true],
    ]);
  });
});

describe("neighborhood, summary, fromNeighbors", () => {
  const links = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "d", target: "c" },
  ];
  test("walks links in both directions up to the depth", () => {
    expect([...neighborhood(links, "b", 1)].sort()).toEqual(["a", "b", "c"]);
    expect([...neighborhood(links, "a", 2)].sort()).toEqual(["a", "b", "c"]);
    expect([...neighborhood(links, "a", 3)].sort()).toEqual(["a", "b", "c", "d"]);
  });
  test("the summary says what the drawing shows", () => {
    const g = buildGraph(data, { filter: filter(), colorBy: "type", showMissing: true, now: NOW });
    expect(summary(g, false)).toBe("4 items, 2 links, 1 not linked");
    expect(summary(g, true)).toBe(
      "4 items, 2 links, 1 not linked. Showing the first part of a larger memory",
    );
  });
  test("an item's neighbors become a small graph keyed by slug", () => {
    const g = fromNeighbors({
      slug: "a",
      nodes: [{ slug: "b", title: "B" }],
      edges: [{ from: "a", to: "b", relation: "part-of" }],
    });
    expect(g.nodes.map((n) => [n.id, n.title, n.inDegree, n.outDegree])).toEqual([
      ["a", "a", 0, 1],
      ["b", "B", 1, 0],
    ]);
  });
});

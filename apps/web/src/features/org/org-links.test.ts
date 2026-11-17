import { describe, expect, test } from "bun:test";

import type { OrgLink, OrgPosition } from "./org-api";
import { toFlow } from "./org-graph";
import { botNames, linkEdges, linkSentence, namedLinks, shared } from "./org-links";

const bot = (id: string, name: string) =>
  ({ kind: "bot", botId: id, name, description: "", avatar: null }) as const;
const seat = (id: string, parentId: string | null, order: number, over: Partial<OrgPosition>) =>
  ({
    id,
    parentId,
    rank: parentId === null ? "ceo" : "member",
    title: id,
    description: "",
    unit: "",
    sortOrder: order,
    templateKey: null,
    seat: "open",
    holder: null,
    problem: null,
    team: null,
    ...over,
  }) as OrgPosition;

// CEO ─ A (bot a) ─ C (bot c)
//     └─ B (bot b)
const positions = [
  seat("CEO", null, 0, {}),
  seat("A", "CEO", 0, { seat: "bot", holder: bot("a", "Ana") }),
  seat("B", "CEO", 1, { seat: "bot", holder: bot("b", "Bia") }),
  seat("C", "A", 0, { seat: "bot", holder: bot("c", "Caio") }),
];
const link = (aId: string, bId: string, counts: Partial<OrgLink["counts"]>): OrgLink => {
  const c = { room: 0, workflow: 0, handoff: 0, ...counts };
  return { aId, bId, counts: c, weight: c.room + c.workflow + c.handoff, kinds: [] };
};
const nodes = (collapsed: string[] = []) =>
  toFlow(positions, {
    collapsed: new Set(collapsed),
    filters: { q: "", show: "links" },
    canEdit: false,
  }).nodes;

describe("the words of a line", () => {
  test("rooms, workflows and handoffs are counted with the right noun", () => {
    expect(shared({ room: 3, workflow: 1, handoff: 0 })).toBe("3 rooms, 1 workflow");
    expect(shared({ room: 1, workflow: 0, handoff: 2 })).toBe("1 room, 2 decision handoffs");
    expect(linkSentence({ counts: { room: 3, workflow: 1, handoff: 0 } })).toBe(
      "Work together in 3 rooms, 1 workflow",
    );
  });

  test("a pair is named by the bots that hold seats; a bot the chart does not show is left out", () => {
    expect([...botNames(positions)]).toEqual([
      ["a", "Ana"],
      ["b", "Bia"],
      ["c", "Caio"],
    ]);
    const named = namedLinks(
      [link("a", "b", { room: 2 }), link("a", "zzz", { room: 1 })],
      positions,
    );
    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({ names: ["Ana", "Bia"], sentence: "Work together in 2 rooms" });
  });
});

describe("the dotted lines on the canvas", () => {
  test("two seats side by side join facing sides, left to right, whichever way the pair is written", () => {
    const edges = linkEdges([link("b", "a", { room: 1 })], nodes());
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "works",
      source: "A",
      target: "B",
      sourceHandle: "r-out",
      targetHandle: "l-in",
      ariaLabel: "Bia and Ana: Work together in 1 room",
    });
  });

  test("a manager and its report share a column: the line joins their right sides, apart from the reporting line", () => {
    const edges = linkEdges([link("a", "c", { handoff: 1 })], nodes());
    expect(edges[0]).toMatchObject({
      source: "A",
      target: "C",
      sourceHandle: "r-out",
      targetHandle: "r-in",
    });
  });

  test("a seat inside a folded branch has no place, so its lines wait", () => {
    expect(linkEdges([link("a", "c", { room: 1 })], nodes(["A"]))).toEqual([]);
  });

  test("a pair with a bot that holds no seat draws nothing, and the reporting lines stay apart", () => {
    expect(linkEdges([link("a", "nobody", { room: 1 })], nodes())).toEqual([]);
    const flow = toFlow(positions, {
      collapsed: new Set(),
      filters: { q: "", show: "links" },
      canEdit: false,
    });
    expect(flow.edges.every((e) => e.type === "smoothstep")).toBe(true);
  });
});

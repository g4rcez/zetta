import { describe, expect, test } from "bun:test";

import type { OrgPosition } from "./org-api";
import {
  SEAT_SIZE,
  breadcrumb,
  dropMove,
  foldedAfterSearch,
  hiddenSeats,
  holderLine,
  layoutTree,
  managerChoices,
  seatAt,
  shiftSeat,
  toFlow,
} from "./org-graph";

const seat = (
  id: string,
  parentId: string | null,
  over: Partial<OrgPosition> = {},
): OrgPosition => ({
  id,
  parentId,
  rank: parentId === null ? "ceo" : "member",
  title: id.toUpperCase(),
  description: "",
  unit: "",
  sortOrder: 0,
  templateKey: null,
  seat: "open",
  holder: null,
  problem: null,
  team: null,
  ...over,
});
const person = (userId: string, name: string): OrgPosition["holder"] => ({
  kind: "person",
  userId,
  name,
  avatar: null,
});

// ceo ─ cto ─ dev1, dev2
//    └─ cfo
const chart: OrgPosition[] = [
  seat("ceo", null, { seat: "person", holder: person("u1", "Ana") }),
  seat("cto", "ceo", { rank: "executive", sortOrder: 0 }),
  seat("cfo", "ceo", { rank: "executive", sortOrder: 1 }),
  seat("dev1", "cto", { sortOrder: 0 }),
  seat("dev2", "cto", { sortOrder: 1 }),
];
const none = new Set<string>();

describe("layout", () => {
  test("a seat sits centered over its reports and each level is one row down", () => {
    const at = layoutTree(chart, none);
    const w = SEAT_SIZE.w + 24;
    expect(at.get("dev1")).toEqual({ x: 0, y: 2 * (SEAT_SIZE.h + 56) });
    expect(at.get("dev2")!.x).toBe(w);
    // cto is centered over its two reports
    expect(at.get("cto")!.x).toBe((0 + w) / 2);
    expect(at.get("ceo")!.y).toBe(0);
    expect(at.get("cfo")!.y).toBe(SEAT_SIZE.h + 56);
    // siblings never overlap
    expect(at.get("cfo")!.x).toBeGreaterThanOrEqual(at.get("cto")!.x + SEAT_SIZE.w + 24 - 1);
  });

  test("a folded seat counts as a leaf and hides what is under it", () => {
    const folded = new Set(["cto"]);
    expect(hiddenSeats(chart, folded)).toEqual(new Set(["dev1", "dev2"]));
    const at = layoutTree(chart, folded);
    expect(at.has("dev1")).toBe(false); // not placed at all, so the row closes up
    // cto no longer needs room for two reports: it and cfo sit side by side from the left edge
    expect(at.get("cto")!.x).toBe(0);
    expect(at.get("cfo")!.x).toBe(SEAT_SIZE.w + 24);
    const flow = toFlow(chart, {
      collapsed: folded,
      filters: { q: "", show: "everyone" },
      canEdit: true,
    });
    expect(flow.nodes.map((n) => n.id).sort()).toEqual(["ceo", "cfo", "cto"]);
    expect(flow.nodes.find((n) => n.id === "cto")!.data).toMatchObject({
      collapsed: true,
      reports: 2,
    });
  });

  test("an empty chart has no layout", () => {
    expect(layoutTree([], none).size).toBe(0);
    expect(
      toFlow([], { collapsed: none, filters: { q: "", show: "everyone" }, canEdit: false }),
    ).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

describe("flow", () => {
  const flow = toFlow(chart, {
    collapsed: none,
    filters: { q: "", show: "everyone" },
    canEdit: true,
  });

  test("one line from each manager to each report", () => {
    expect(flow.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual([
      "ceo>cfo",
      "ceo>cto",
      "cto>dev1",
      "cto>dev2",
    ]);
  });

  test("only an editor can drag a seat, and never the CEO", () => {
    expect(flow.nodes.find((n) => n.id === "ceo")!.draggable).toBe(false);
    expect(flow.nodes.find((n) => n.id === "dev1")!.draggable).toBe(true);
    const reader = toFlow(chart, {
      collapsed: none,
      filters: { q: "", show: "everyone" },
      canEdit: false,
    });
    expect(reader.nodes.every((n) => n.draggable === false)).toBe(true);
  });

  test("filters point seats out without removing the others", () => {
    const f = toFlow(chart, {
      collapsed: none,
      filters: { q: "ana", show: "everyone" },
      canEdit: false,
    });
    expect(f.nodes).toHaveLength(5);
    expect(f.nodes.filter((n) => n.data.match === "yes").map((n) => n.id)).toEqual(["ceo"]);
    expect(f.nodes.filter((n) => n.data.match === "no")).toHaveLength(4);
    expect(flow.nodes.every((n) => n.data.match === "off")).toBe(true);
  });

  test("a search opens the folded seats above what it found", () => {
    const found = new Set(["dev1"]);
    expect(foldedAfterSearch(chart, new Set(["cto", "cfo"]), found)).toEqual(new Set(["cfo"]));
    const f = toFlow(chart, {
      collapsed: new Set(["cto"]),
      filters: { q: "dev1", show: "everyone" },
      canEdit: false,
    });
    expect(f.nodes.map((n) => n.id)).toContain("dev1");
  });
});

describe("dropping a seat on another", () => {
  test("finds the seat under a point, the top one first, never the dragged seat", () => {
    const nodes = [
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: 10, y: 10 } },
    ];
    expect(seatAt(nodes, { x: 20, y: 20 })).toBe("b");
    expect(seatAt(nodes, { x: 20, y: 20 }, "b")).toBe("a");
    expect(seatAt(nodes, { x: 900, y: 900 })).toBeUndefined();
  });

  test("moving under another seat is allowed; the same manager or itself is a no-op", () => {
    expect(dropMove(chart, "dev1", "cfo")).toEqual({ kind: "move", parentId: "cfo" });
    expect(dropMove(chart, "dev1", "cto")).toEqual({ kind: "noop" });
    expect(dropMove(chart, "dev1", "dev1")).toEqual({ kind: "noop" });
  });

  test("a seat cannot move under one of its own reports, and the CEO cannot move", () => {
    expect(dropMove(chart, "cto", "dev1")).toEqual({
      kind: "refused",
      message: "A seat cannot report to one of its own reports.",
    });
    expect(dropMove(chart, "ceo", "cto")).toMatchObject({ kind: "refused" });
  });
});

describe("order, managers and words", () => {
  test("a seat moves earlier or later among its siblings, and stops at the ends", () => {
    expect(shiftSeat(chart, "dev2", -1)).toEqual({ parentId: "cto", index: 0 });
    expect(shiftSeat(chart, "dev1", 1)).toEqual({ parentId: "cto", index: 1 });
    expect(shiftSeat(chart, "dev1", -1)).toBeUndefined();
    expect(shiftSeat(chart, "dev2", 1)).toBeUndefined();
    expect(shiftSeat(chart, "ceo", 1)).toBeUndefined();
  });

  test("the breadcrumb runs from the CEO down to the seat", () => {
    expect(breadcrumb(chart, "dev1").map((p) => p.id)).toEqual(["ceo", "cto", "dev1"]);
    expect(breadcrumb(chart, "gone")).toEqual([]);
  });

  test("a seat can report to any seat except itself and the seats below it", () => {
    expect(
      managerChoices(chart, "cto")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["ceo", "cfo"]);
    expect(
      managerChoices(chart, "dev1")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["ceo", "cfo", "cto", "dev2"]);
  });

  test("an open seat says who it had", () => {
    expect(holderLine(chart[0]!)).toBe("Ana");
    expect(holderLine(seat("x", "ceo"))).toBe("Open seat");
    expect(
      holderLine(
        seat("x", "ceo", { problem: { code: "member_removed", was: "Rui", mine: false } }),
      ),
    ).toBe("Open seat (was Rui)");
  });
});

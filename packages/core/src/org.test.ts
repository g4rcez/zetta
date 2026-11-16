import { describe, expect, test } from "bun:test";
import {
  ORG_MAX_DEPTH,
  ancestorsOf,
  canMove,
  childrenOf,
  depthOf,
  descendantsOf,
  heightOf,
  nearestManager,
  positionsOf,
  validateTree,
  type OrgRank,
  type OrgSeat,
} from "./org";

type Seat = {
  id: string;
  parentId: string | null;
  rank: OrgRank;
  seat: OrgSeat;
  sortOrder: number;
  userId?: string;
  botId?: string;
};
const seat = (id: string, parentId: string | null, over: Partial<Seat> = {}): Seat => ({
  id,
  parentId,
  rank: parentId === null ? "ceo" : "member",
  seat: "person",
  sortOrder: 0,
  ...over,
});

// ceo ─ cto ─ lead ─ dev
//    └─ cfo
const chart: Seat[] = [
  seat("ceo", null, { userId: "u-ceo" }),
  seat("cto", "ceo", { rank: "executive", botId: "b-cto", seat: "bot" }),
  seat("cfo", "ceo", { rank: "executive", sortOrder: 1, userId: "u-cfo" }),
  seat("lead", "cto", { rank: "lead", seat: "open" }),
  seat("dev", "lead", { botId: "b-dev", seat: "bot" }),
];

describe("org tree", () => {
  test("a sound chart has no problem, and an empty one is fine", () => {
    expect(validateTree(chart)).toBeNull();
    expect(validateTree([])).toBeNull();
  });

  test("reads the shape of the chart", () => {
    expect(childrenOf(chart, "ceo").map((n) => n.id)).toEqual(["cto", "cfo"]);
    expect(descendantsOf(chart, "cto").sort()).toEqual(["dev", "lead"]);
    expect(ancestorsOf(chart, "dev").map((n) => n.id)).toEqual(["lead", "cto", "ceo"]);
    expect(depthOf(chart, "ceo")).toBe(1);
    expect(depthOf(chart, "dev")).toBe(4);
    expect(heightOf(chart, "cto")).toBe(3);
    expect(heightOf(chart, "cfo")).toBe(1);
  });

  test("children follow sortOrder, then id", () => {
    const flat = [
      seat("ceo", null),
      seat("b", "ceo"),
      seat("a", "ceo"),
      seat("z", "ceo", { sortOrder: -1 }),
    ];
    expect(childrenOf(flat, "ceo").map((n) => n.id)).toEqual(["z", "a", "b"]);
  });

  test("refuses a chart with no top, two tops or a top that is not the CEO", () => {
    expect(validateTree([seat("a", "b"), seat("b", "a")])?.code).toBe("no_root");
    expect(validateTree([seat("a", null), seat("b", null)])?.code).toBe("many_roots");
    expect(validateTree([seat("a", null, { rank: "lead" })])?.code).toBe("root_not_ceo");
    expect(validateTree([seat("a", null), seat("b", "a", { rank: "ceo" })])?.code).toBe(
      "extra_ceo",
    );
  });

  test("refuses a seat under a seat that does not exist", () => {
    expect(validateTree([seat("a", null), seat("b", "gone")])?.code).toBe("missing_parent");
  });

  test("finds a loop that sits apart from the CEO", () => {
    expect(validateTree([seat("ceo", null), seat("a", "b"), seat("b", "a")])?.code).toBe("cycle");
  });

  test("refuses a chain longer than the limit", () => {
    const long = [seat("n0", null)];
    for (let i = 1; i <= ORG_MAX_DEPTH; i++) long.push(seat(`n${i}`, `n${i - 1}`));
    expect(validateTree(long)?.code).toBe("too_deep");
    expect(validateTree(long.slice(0, ORG_MAX_DEPTH))).toBeNull();
  });
});

describe("moving a seat", () => {
  test("allows a seat under another one", () => {
    expect(canMove(chart, "dev", "cfo")).toBeNull();
    expect(canMove(chart, "lead", "ceo")).toBeNull();
  });

  test("refuses itself, its own reports and the top", () => {
    expect(canMove(chart, "cto", "cto")?.code).toBe("self");
    expect(canMove(chart, "cto", "dev")?.code).toBe("under_own_report");
    expect(canMove(chart, "ceo", "cto")?.code).toBe("root_move");
    expect(canMove(chart, "cto", "gone")?.code).toBe("not_found");
  });

  test("refuses a move that would make the chart too deep", () => {
    const long = [seat("n0", null)];
    for (let i = 1; i < ORG_MAX_DEPTH; i++) long.push(seat(`n${i}`, `n${i - 1}`));
    const withBranch = [...long, seat("side", "n0"), seat("side-child", "side")];
    expect(canMove(withBranch, "side", `n${ORG_MAX_DEPTH - 1}`)?.code).toBe("too_deep");
    expect(canMove(withBranch, "side-child", `n${ORG_MAX_DEPTH - 2}`)).toBeNull();
  });
});

describe("who a seat reports to", () => {
  test("the nearest manager skips seats nobody holds", () => {
    expect(nearestManager(chart, "dev")?.id).toBe("cto");
    expect(nearestManager(chart, "cto")?.id).toBe("ceo");
    expect(nearestManager(chart, "ceo")).toBeUndefined();
  });

  test("a chain of open seats reaches the next held one", () => {
    const open = chart.map((n) => (n.id === "cto" ? { ...n, seat: "open" as const } : n));
    expect(nearestManager(open, "dev")?.id).toBe("ceo");
  });

  test("finds the seats a person or a bot holds", () => {
    expect(positionsOf(chart, { kind: "person", id: "u-cfo" }).map((n) => n.id)).toEqual(["cfo"]);
    expect(positionsOf(chart, { kind: "bot", id: "b-dev" }).map((n) => n.id)).toEqual(["dev"]);
    expect(positionsOf(chart, { kind: "bot", id: "u-cfo" })).toEqual([]);
  });
});

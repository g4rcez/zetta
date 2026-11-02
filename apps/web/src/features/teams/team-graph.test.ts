import { describe, expect, test } from "bun:test";
import {
  addBot,
  arrange,
  dropBot,
  dropTarget,
  flowToTeams,
  makeChief,
  teamsToFlow,
  type BotNode,
} from "./team-graph";
import type { Team } from "./teams-api";

const team = (id: string, x: number, bots: [string, "chief" | "member"][]): Team => ({
  id,
  name: `Team ${id}`,
  goal: "Ship",
  context: "",
  version: 3,
  canvas: { x, y: 0, w: 300, h: 200 },
  members: bots.map(([botId, kind], i) => ({
    botId,
    name: botId.toUpperCase(),
    kind,
    roleId: null,
    role: "",
    canvas: { x: 10, y: 40 + i * 60 },
  })),
});
const kinds = (nodes: ReturnType<typeof teamsToFlow>) =>
  nodes.filter((n): n is BotNode => n.type === "bot").map((n) => `${n.id}=${n.data.kind}`);

describe("teams canvas model", () => {
  test("round-trips the server teams through the canvas without loss", () => {
    const teams = [
      team("t1", 0, [
        ["a", "chief"],
        ["b", "member"],
      ]),
      team("t2", 400, [["c", "chief"]]),
    ];
    const back = flowToTeams(teamsToFlow(teams));
    expect(back.map((b) => b.save)).toEqual(
      teams.map((t) => ({
        expectedVersion: 3,
        name: t.name,
        goal: "Ship",
        canvas: t.canvas,
        members: t.members.map(({ name: _n, role: _r, ...m }) => m),
      })),
    );
  });

  test("the point picks the group that holds it, the top-most one first", () => {
    const groups = [
      { id: "g1", x: 0, y: 0, w: 300, h: 200 },
      { id: "g2", x: 250, y: 0, w: 300, h: 200 },
    ];
    expect(dropTarget({ x: 100, y: 100 }, groups)).toBe("g1");
    expect(dropTarget({ x: 260, y: 100 }, groups)).toBe("g2");
    expect(dropTarget({ x: 700, y: 100 }, groups)).toBeUndefined();
  });

  test("the first bot added to an empty team becomes its chief, later ones are members", () => {
    const empty = teamsToFlow([team("t1", 0, [])]);
    const one = addBot(empty, "team:t1", { botId: "a", name: "A" }, { x: 10, y: 40 });
    const two = addBot(one, "team:t1", { botId: "b", name: "B" }, { x: 10, y: 100 });
    expect(kinds(two)).toEqual(["t1:a=chief", "t1:b=member"]);
  });

  test("a bot cannot join the same team twice, but a team can hold any number of bots", () => {
    let nodes = teamsToFlow([team("t1", 0, [["a", "chief"]])]);
    expect(addBot(nodes, "team:t1", { botId: "a", name: "A" }, { x: 0, y: 0 })).toBe(nodes);
    for (const id of ["b", "c", "d", "e", "f", "g", "h", "i"])
      nodes = addBot(nodes, "team:t1", { botId: id, name: id }, { x: 0, y: 0 });
    expect(kinds(nodes)).toHaveLength(9);
  });

  test("making a bot chief demotes the old chief", () => {
    const nodes = teamsToFlow([
      team("t1", 0, [
        ["a", "chief"],
        ["b", "member"],
      ]),
    ]);
    expect(kinds(makeChief(nodes, "t1:b"))).toEqual(["t1:a=member", "t1:b=chief"]);
  });

  test("dragging a bot out of every group removes it, and a removed chief passes the role on", () => {
    const nodes = teamsToFlow([
      team("t1", 0, [
        ["a", "chief"],
        ["b", "member"],
      ]),
    ]);
    expect(kinds(dropBot(nodes, "t1:a", { x: 900, y: 900 }))).toEqual(["t1:b=chief"]);
  });

  test("dragging a bot into another group moves it there with a position relative to that group", () => {
    const nodes = teamsToFlow([
      team("t1", 0, [
        ["a", "chief"],
        ["b", "member"],
      ]),
      team("t2", 400, [["c", "chief"]]),
    ]);
    const moved = dropBot(nodes, "t1:b", { x: 450, y: 120 });
    expect(kinds(moved)).toEqual(["t1:a=chief", "t2:c=chief", "t2:b=member"]);
    expect(moved.find((n) => n.id === "t2:b")!.position).toEqual({ x: 55, y: 156 });
  });

  test("arranges bots in a centered grid under the title, the chief first, and fits the group height", () => {
    const wide = {
      ...team("t1", 0, [
        ["a", "member"],
        ["b", "chief"],
        ["c", "member"],
      ]),
    };
    wide.canvas = { x: 0, y: 0, w: 440, h: 100 };
    const nodes = arrange(teamsToFlow([wide]));
    const at = (id: string) => nodes.find((n) => n.id === id)!.position;
    expect(at("t1:b")).toEqual({ x: 24, y: 88 });
    expect(at("t1:a")).toEqual({ x: 226, y: 88 });
    expect(at("t1:c")).toEqual({ x: 24, y: 156 });
    expect(nodes.find((n) => n.id === "team:t1")!.height).toBe(228);
  });

  test("dropping a bot onto another slot of its own team reorders the grid", () => {
    const wide = team("t1", 0, [
      ["a", "chief"],
      ["b", "member"],
      ["c", "member"],
    ]);
    wide.canvas = { x: 0, y: 0, w: 440, h: 240 };
    const nodes = arrange(teamsToFlow([wide]));
    const dragged = nodes.map((n) => (n.id === "t1:c" ? { ...n, position: { x: 200, y: 88 } } : n));
    const after = dropBot(dragged, "t1:c", { x: 200, y: 88 });
    expect(after.find((n) => n.id === "t1:c")!.position).toEqual({ x: 226, y: 88 });
    expect(after.find((n) => n.id === "t1:b")!.position).toEqual({ x: 24, y: 156 });
  });
});

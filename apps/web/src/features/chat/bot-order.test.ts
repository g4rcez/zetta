import { expect, test } from "bun:test";

import { moveInGroup, orderBots, placeGroup } from "./bot-order";

const chief = { id: "c", kind: "chief" };
const writer = { id: "w", kind: "specialist" };
const coder = { id: "k", kind: "specialist" };
const analyst = { id: "a", kind: "specialist" };

test("the chief stays first even when the saved order lists it last", () => {
  const { chief: first, rest } = orderBots([writer, coder, chief], ["k", "w", "c"]);
  expect(first).toEqual(chief);
  expect(rest.map((b) => b.id)).toEqual(["k", "w"]);
});

test("bots the person never placed follow the placed ones, in the server's order", () => {
  const { rest } = orderBots([chief, writer, coder, analyst], ["a"]);
  expect(rest.map((b) => b.id)).toEqual(["a", "w", "k"]);
});

test("an id of a bot that no longer exists is ignored", () => {
  const { rest } = orderBots([writer, coder], ["gone", "k", "w"]);
  expect(rest.map((b) => b.id)).toEqual(["k", "w"]);
});

test("placing one group keeps the bots of other groups in the saved order", () => {
  expect(placeGroup(["x", "w", "y", "k"], ["k", "w"])).toEqual(["x", "y", "k", "w"]);
});

test("the saved order never grows past the 500 ids the server accepts", () => {
  const long = Array.from({ length: 500 }, (_, i) => `b${i}`);
  const saved = placeGroup(long, ["new"]);
  expect(saved.length).toBe(500);
  expect(saved.at(-1)).toBe("new");
  expect(saved[0]).toBe("b1");
});

test("move up and move down swap a bot with its neighbour and report its new position", () => {
  expect(moveInGroup(["w", "k", "a"], "k", -1)).toEqual({ group: ["k", "w", "a"], position: 1 });
  expect(moveInGroup(["w", "k", "a"], "k", 1)).toEqual({ group: ["w", "a", "k"], position: 3 });
});

test("a bot at the edge of its group does not move past it", () => {
  expect(moveInGroup(["w", "k"], "w", -1)).toBeUndefined();
  expect(moveInGroup(["w", "k"], "k", 1)).toBeUndefined();
  expect(moveInGroup(["w", "k"], "missing", 1)).toBeUndefined();
});

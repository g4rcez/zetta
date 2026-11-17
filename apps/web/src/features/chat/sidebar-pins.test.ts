import { expect, test } from "bun:test";

import { nextPins, pickPinned, pinnedBots, withPin } from "./sidebar-pins";

const bot = (id: string, kind = "specialist") => ({ id, kind, name: id });
const chief = bot("chief", "chief");
const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => bot(id));
const all = [chief, a!, b!, c!, d!];

test("pinned bots come back in the order they were pinned, not the server's", () => {
  expect(pinnedBots(all, ["c", "a"]).map((x) => x.id)).toEqual(["c", "a"]);
});

test("the chief is never a pin, a missing bot is ignored, and a repeat counts once", () => {
  expect(pinnedBots(all, ["chief", "gone", "b", "b"]).map((x) => x.id)).toEqual(["b"]);
});

test("with pins the sidebar lists the chief, then the pins, with no cap", () => {
  const shown = pickPinned(all, ["d", "b", "a", "c"], undefined)!;
  expect(shown.map((x) => x.id)).toEqual(["chief", "d", "b", "a", "c"]);
});

test("the open bot is added at the end when it is not pinned, and not twice when it is", () => {
  expect(pickPinned(all, ["a"], "c")!.map((x) => x.id)).toEqual(["chief", "a", "c"]);
  expect(pickPinned(all, ["a"], "a")!.map((x) => x.id)).toEqual(["chief", "a"]);
});

test("nothing pinned, or only stale pins, means the sidebar picks by itself", () => {
  expect(pickPinned(all, [], "a")).toBeUndefined();
  expect(pickPinned(all, ["gone", "chief"], "a")).toBeUndefined();
});

test("pinning puts a bot last, unpinning removes it, and nobody is listed twice", () => {
  expect(withPin(["a", "b"], "c", true)).toEqual(["a", "b", "c"]);
  expect(withPin(["a", "b", "c"], "a", true)).toEqual(["b", "c", "a"]);
  expect(withPin(["a", "b"], "a", false)).toEqual(["b"]);
  expect(withPin(["a"], "z", false)).toEqual(["a"]);
});

test("the first pin starts from the list on screen, so it adds to what the person sees", () => {
  // Nothing pinned: the sidebar shows the chief, c and a. Pinning d keeps those and adds d.
  expect(nextPins(all, [], [chief, c!, a!], "d", true)).toEqual(["c", "a", "d"]);
  // Unpinning a bot of the automatic list leaves the others.
  expect(nextPins(all, [], [chief, c!, a!], "c", false)).toEqual(["a"]);
});

test("once bots are pinned, the pins are the starting point and stale ones drop out", () => {
  expect(nextPins(all, ["b", "gone"], [chief, a!], "d", true)).toEqual(["b", "d"]);
  expect(nextPins(all, ["b", "d"], [chief, b!, d!], "b", false)).toEqual(["d"]);
});

import { describe, expect, it } from "bun:test";
import { focusKey, mergeOrder, progressOf, skipKey } from "./queue-order";

describe("mergeOrder", () => {
  it("starts with the server's order", () => {
    expect(mergeOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("keeps the order of the visit and appends new cards at the end", () => {
    expect(mergeOrder(["b", "c", "a"], ["a", "b", "c", "d"])).toEqual(["b", "c", "a", "d"]);
  });

  it("drops cards that were decided somewhere else", () => {
    expect(mergeOrder(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"]);
  });

  it("never lists a card twice", () => {
    expect(mergeOrder(["a"], ["a", "a", "b"])).toEqual(["a", "b"]);
    expect(mergeOrder([], ["a", "a"])).toEqual(["a"]);
  });
});

describe("skipKey", () => {
  it("moves the card to the back", () => {
    expect(skipKey(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
  });

  it("leaves the order alone for a card that is not there", () => {
    expect(skipKey(["a", "b"], "x")).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const order = ["a", "b"];
    skipKey(order, "a");
    expect(order).toEqual(["a", "b"]);
  });
});

describe("focusKey", () => {
  it("puts a deep-linked card first", () => {
    expect(focusKey(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("ignores a card that is not in the queue, or no key", () => {
    expect(focusKey(["a", "b"], "x")).toEqual(["a", "b"]);
    expect(focusKey(["a", "b"], undefined)).toEqual(["a", "b"]);
  });
});

describe("progressOf", () => {
  it("counts what was handled plus what is left", () => {
    expect(progressOf(0, 12)).toEqual({ position: 1, total: 12 });
    expect(progressOf(2, 10)).toEqual({ position: 3, total: 12 });
  });

  it("never shows a position past the total", () => {
    expect(progressOf(5, 0)).toEqual({ position: 5, total: 5 });
    expect(progressOf(0, 0)).toEqual({ position: 1, total: 0 });
  });
});

import { describe, expect, test } from "bun:test";

import { splitPassage } from "./memory-passage";

describe("splitPassage", () => {
  test("runs between the markers are hits", () => {
    expect(splitPassage("a \u0001refund\u0002 policy \u0001now\u0002")).toEqual([
      { text: "a ", hit: false },
      { text: "refund", hit: true },
      { text: " policy ", hit: false },
      { text: "now", hit: true },
    ]);
  });
  test("a text without markers is one plain run, and an empty one is none", () => {
    expect(splitPassage("plain")).toEqual([{ text: "plain", hit: false }]);
    expect(splitPassage("")).toEqual([]);
  });
});

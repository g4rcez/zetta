import { describe, expect, test } from "bun:test";

import { parseBlocks } from "./markdown";

describe("parseBlocks", () => {
  test("parses ordered lists with their start number", () => {
    expect(parseBlocks("3. three\n4. four")).toEqual([{ type: "ol", items: ["three", "four"], start: 3 }]);
  });
  test("keeps bullet and numbered lists separate", () => {
    expect(parseBlocks("- a\n- b\n1. c")).toEqual([{ type: "ul", items: ["a", "b"] }, { type: "ol", items: ["c"], start: 1 }]);
  });
  test("fenced code and paragraphs", () => {
    expect(parseBlocks("hi\n```\n1. not a list\n```")).toEqual([{ type: "p", text: "hi" }, { type: "code", text: "1. not a list" }]);
  });
});

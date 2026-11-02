import { describe, expect, test } from "bun:test";

import { codeLanguage, tagPatches } from "./code-fence";
import { parseBlocks } from "./markdown";

describe("parseBlocks", () => {
  test("parses ordered lists with their start number", () => {
    expect(parseBlocks("3. three\n4. four")).toEqual([
      { type: "ol", items: ["three", "four"], start: 3 },
    ]);
  });
  test("keeps bullet and numbered lists separate", () => {
    expect(parseBlocks("- a\n- b\n1. c")).toEqual([
      { type: "ul", items: ["a", "b"] },
      { type: "ol", items: ["c"], start: 1 },
    ]);
  });
  test("fenced code and paragraphs", () => {
    expect(parseBlocks("hi\n```\n1. not a list\n```")).toEqual([
      { type: "p", text: "hi" },
      { type: "code", text: "1. not a list", lang: "" },
    ]);
  });
});

const PATCH = "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-a\n+b";

describe("fenced code language", () => {
  test("keeps the language of a fence", () => {
    expect(parseBlocks("```ts\nlet a;\n```")).toEqual([
      { type: "code", text: "let a;", lang: "ts" },
    ]);
  });
  test("an untagged block with a patch is diff", () => {
    expect(codeLanguage("", PATCH)).toBe("diff");
    expect(codeLanguage("", "plain text")).toBe("");
    expect(codeLanguage("ts", PATCH)).toBe("ts");
  });
  test("tagPatches tags only untagged patch fences", () => {
    expect(tagPatches("```\n" + PATCH + "\n```")).toBe("```diff\n" + PATCH + "\n```");
    expect(tagPatches("```\nhello\n```")).toBe("```\nhello\n```");
    expect(tagPatches("```ts\n" + PATCH + "\n```")).toBe("```ts\n" + PATCH + "\n```");
  });
});

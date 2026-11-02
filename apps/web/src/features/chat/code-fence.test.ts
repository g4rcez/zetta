import { describe, expect, it } from "bun:test";

import { fence, languageOf } from "./code-fence";

describe("languageOf", () => {
  it("takes the extension, in lower case", () => {
    expect(languageOf("src/Main.RS")).toBe("rs");
    expect(languageOf("fix.diff")).toBe("diff");
  });
  it("falls back to text", () => {
    expect(languageOf("Makefile")).toBe("text");
  });
});

describe("fence", () => {
  it("wraps code in a fence with its language", () => {
    expect(fence("let a = 1;", "ts")).toBe("```ts\nlet a = 1;\n```");
  });
  it("uses a longer fence than any backticks in the code", () => {
    expect(fence("a\n```js\nb\n```", "md")).toBe("````md\na\n```js\nb\n```\n````");
  });
  it("keeps only safe characters of the language", () => {
    expect(fence("x", "ts\n# evil")).toBe("```ts#evil\nx\n```");
  });
});

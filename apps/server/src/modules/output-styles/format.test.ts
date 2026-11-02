import { describe, expect, test } from "bun:test";
import { fromMarkdown, StyleFormatError, toMarkdown } from "./format";

describe("output style file", () => {
  test("exports the Claude Code layout", () => {
    expect(
      toMarkdown({
        name: "Pirate",
        description: "Talks like a pirate",
        body: "Say arr.\nBe brief.",
      }),
    ).toBe('---\nname: "Pirate"\ndescription: "Talks like a pirate"\n---\n\nSay arr.\nBe brief.\n');
  });

  test("imports what it exports, including quotes and colons", () => {
    const doc = { name: 'The "Boss": firm', description: "Short: direct", body: "Decide fast." };
    expect(fromMarkdown(toMarkdown(doc))).toEqual(doc);
  });

  test("imports a Claude Code file and ignores unknown keys", () => {
    const file =
      "---\nname: Terse\ndescription: Few words\nkeep-coding-instructions: true\n---\n\nAnswer in one line.\n";
    expect(fromMarkdown(file)).toEqual({
      name: "Terse",
      description: "Few words",
      body: "Answer in one line.",
    });
  });

  test("accepts single-quoted values and Windows line breaks", () => {
    expect(fromMarkdown("---\r\nname: 'It''s ok'\r\n---\r\nBe kind.\r\n")).toEqual({
      name: "It's ok",
      description: "",
      body: "Be kind.",
    });
  });

  test("rejects a file without frontmatter", () => {
    expect(() => fromMarkdown("Just text")).toThrow(StyleFormatError);
  });

  test("rejects a file without a name", () => {
    expect(() => fromMarkdown("---\ndescription: x\n---\nBody")).toThrow(StyleFormatError);
  });

  test("rejects an empty body", () => {
    expect(() => fromMarkdown("---\nname: Empty\n---\n")).toThrow(StyleFormatError);
  });

  test("rejects a body over the limit", () => {
    expect(() => fromMarkdown(`---\nname: Big\n---\n${"a".repeat(8193)}`)).toThrow(
      StyleFormatError,
    );
  });
});

import { describe, expect, test } from "bun:test";

import { firstSentence, guideMarkdown, resolved, summaryOf } from "./guide-md";

const slugs = new Set(["getting-started", "work-and-attention"]);

describe("guideMarkdown", () => {
  const raw = [
    "# Title",
    "",
    "[Wiki home](../README.md) · [Glossary](../glossary.md)",
    "",
    "> **Status: intended v1.** Note.",
    "",
    "See [work](work-and-attention.md) and [more](work-and-attention.md#blockers).",
    "RFC [one](../../../tasks/019-x.md), [site](https://example.invalid/a), [top](#top), [abs](/install).",
  ].join("\n");
  const md = guideMarkdown(raw, slugs);

  test("drops the navigation line but keeps the title and the status note", () => {
    expect(md).not.toContain("Wiki home");
    expect(md.startsWith("# Title\n")).toBe(true);
    expect(md).toContain("> **Status: intended v1.** Note.");
  });
  test("a link to another guide page points at its Markdown on the site, with its anchor", () => {
    expect(md).toContain("[work](https://zettabot.app/docs/work-and-attention.md)");
    expect(md).toContain("[more](https://zettabot.app/docs/work-and-attention.md#blockers)");
  });
  test("any other relative link points at the file on GitHub", () => {
    expect(md).toContain("[one](https://github.com/g4rcez/zetta/blob/main/tasks/019-x.md)");
  });
  test("absolute, anchor and site links are left alone", () => {
    expect(md).toContain("[site](https://example.invalid/a)");
    expect(md).toContain("[top](#top)");
    expect(md).toContain("[abs](/install)");
  });
  test("a link to a page that is not a guide page goes to GitHub, not to the site", () => {
    expect(guideMarkdown("[x](unknown.md)", slugs)).toContain(
      "https://github.com/g4rcez/zetta/blob/main/docs/wiki/user-guide/unknown.md",
    );
  });
});

describe("resolved", () => {
  test("walks ../ up from the guide folder", () => {
    expect(resolved("../../../tasks/x.md")).toBe("tasks/x.md");
    expect(resolved("../glossary.md")).toBe("docs/wiki/glossary.md");
    expect(resolved("./a.md")).toBe("docs/wiki/user-guide/a.md");
  });
});

describe("firstSentence", () => {
  test("ends at the first full stop", () => {
    expect(firstSentence("One thing. Another thing.")).toBe("One thing.");
  });
  test("a full stop inside a quotation does not end it", () => {
    expect(firstSentence("Say “Do this. Then that.” Next sentence.")).toBe(
      "Say “Do this. Then that.”",
    );
  });
  test("keeps a whole text with no full stop, and flattens line breaks", () => {
    expect(firstSentence("no stop\nhere")).toBe("no stop here");
  });
  test("ends at a question or exclamation mark", () => {
    expect(firstSentence("Ready? Go.")).toBe("Ready?");
  });
});

describe("summaryOf", () => {
  test("is the first sentence of the first plain paragraph", () => {
    const md = [
      "# T",
      "",
      "> status",
      "",
      "## H",
      "",
      "Browser use is for sites you may use. More text.",
      "",
    ].join("\n");
    expect(summaryOf(md)).toBe("Browser use is for sites you may use.");
  });
  test("skips tables, lists, code and a paragraph that is only an example", () => {
    const md = [
      "# T",
      "",
      "| a | b |",
      "| - | - |",
      "",
      "- item",
      "",
      "For example: “Do a thing.” Then more.",
      "",
      "The real first paragraph. Second.",
    ].join("\n");
    expect(summaryOf(md)).toBe("The real first paragraph.");
  });
  test("is empty when there is no paragraph", () => expect(summaryOf("# Only a title\n")).toBe(""));
});

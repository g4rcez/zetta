import { describe, expect, test } from "bun:test";

import { rehypeMemoryLinks, splitMemoryLinks } from "./memory-markdown";

describe("splitMemoryLinks", () => {
  test("splits plain and typed links out of the text", () => {
    expect(splitMemoryLinks("See [[acme-billing]] and [[depends-on:acme-auth]] now")).toEqual([
      { text: "See " },
      { text: "[[acme-billing]]", slug: "acme-billing", relation: "related" },
      { text: " and " },
      { text: "[[depends-on:acme-auth]]", slug: "acme-auth", relation: "depends-on" },
      { text: " now" },
    ]);
  });
  test("text without a link, an unknown relation or a bad slug is left alone", () => {
    expect(splitMemoryLinks("nothing here")).toBeUndefined();
    expect(splitMemoryLinks("[[friend-of:x]] [[Not A Slug]] [[]]")).toBeUndefined();
  });
});

describe("rehypeMemoryLinks", () => {
  const run = (tree: unknown) => {
    rehypeMemoryLinks()(tree as never);
    return tree;
  };
  test("links in a paragraph become memory-link elements; code and links are skipped", () => {
    const tree = {
      type: "root",
      children: [
        { type: "element", tagName: "p", children: [{ type: "text", value: "Go to [[a-b]]." }] },
        { type: "element", tagName: "code", children: [{ type: "text", value: "[[in-code]]" }] },
        { type: "element", tagName: "a", children: [{ type: "text", value: "[[in-anchor]]" }] },
      ],
    };
    expect(run(tree)).toEqual({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          children: [
            { type: "text", value: "Go to " },
            {
              type: "element",
              tagName: "memory-link",
              properties: { dataSlug: "a-b", dataRelation: "related" },
              children: [{ type: "text", value: "[[a-b]]" }],
            },
            { type: "text", value: "." },
          ],
        },
        { type: "element", tagName: "code", children: [{ type: "text", value: "[[in-code]]" }] },
        { type: "element", tagName: "a", children: [{ type: "text", value: "[[in-anchor]]" }] },
      ],
    });
  });
});

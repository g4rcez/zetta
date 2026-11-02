import { describe, expect, test } from "bun:test";

import { rehypeWikiLinks, splitWikiLinks } from "./wiki-markdown";

describe("splitWikiLinks", () => {
  test("splits plain and typed links out of the text", () => {
    expect(splitWikiLinks("See [[acme-billing]] and [[depends-on:acme-auth]] now")).toEqual([
      { text: "See " },
      { text: "[[acme-billing]]", slug: "acme-billing", relation: "related" },
      { text: " and " },
      { text: "[[depends-on:acme-auth]]", slug: "acme-auth", relation: "depends-on" },
      { text: " now" },
    ]);
  });
  test("text without a link, an unknown relation or a bad slug is left alone", () => {
    expect(splitWikiLinks("nothing here")).toBeUndefined();
    expect(splitWikiLinks("[[friend-of:x]] [[Not A Slug]] [[]]")).toBeUndefined();
  });
});

describe("rehypeWikiLinks", () => {
  const run = (tree: unknown) => {
    rehypeWikiLinks()(tree as never);
    return tree;
  };
  test("links in a paragraph become wiki-link elements; code and links are skipped", () => {
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
              tagName: "wiki-link",
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

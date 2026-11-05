import { describe, expect, test } from "bun:test";

import { askPrompt, sourcesOf } from "./wiki-ask";

describe("askPrompt", () => {
  test("asks for citations in the wiki's link form", () => {
    expect(askPrompt("  How do refunds work? ")).toBe(
      "Answer from my memory and cite the items you use as [[slug]]. Question: How do refunds work?",
    );
  });
});

describe("sourcesOf", () => {
  const shown = [
    { slug: "refunds", title: "Refunds" },
    { slug: "billing", title: "Billing" },
    { slug: "unused", title: "Unused" },
  ];
  test("items the answer links are cited, the others only considered", () => {
    expect(
      sourcesOf("Refunds take 14 days [[refunds]], see [[depends-on:billing]].", shown),
    ).toEqual({
      cited: [shown[0], shown[1]],
      considered: [shown[2]],
    });
  });
  test("a link to an item that was not shown is not a source, and no link means nothing is cited", () => {
    expect(sourcesOf("See [[elsewhere]].", shown).cited).toEqual([]);
    expect(sourcesOf("No links here.", shown)).toEqual({ cited: [], considered: shown });
  });
});

import { describe, expect, test } from "bun:test";

import { activeIndex, headingIds, headingSlug, readingMinutes } from "./reading";

describe("reading time", () => {
  test("is never under a minute", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("a few words")).toBe(1);
  });
  test("counts words at 230 a minute, and not marks alone", () => {
    expect(readingMinutes("word ".repeat(1150))).toBe(5);
    expect(readingMinutes("| - * # → ".repeat(2000))).toBe(1);
  });
});

describe("heading ids", () => {
  test("drop accents and marks, and keep away from app ids", () => {
    expect(headingSlug("Regra 1 — Pressão & Código")).toBe("doc-regra-1-pressao-codigo");
    expect(headingSlug("???")).toBe("doc-section");
    expect(headingSlug("root")).toBe("doc-root");
  });
  test("are unique, also when a title already ends in a number", () => {
    expect(headingIds(["Step", "Step", "Step 2"])).toEqual([
      "doc-step",
      "doc-step-2",
      "doc-step-2-2",
    ]);
  });
});

describe("the heading being read", () => {
  test("is the last one that passed the line", () => {
    expect(activeIndex([50, 300], false)).toBe(0);
    expect(activeIndex([-300, -1, 200], false)).toBe(1);
  });
  test("is the last one at the end of the document", () => {
    expect(activeIndex([-300, 20, 80], true)).toBe(2);
  });
});

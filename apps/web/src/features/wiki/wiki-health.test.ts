import { describe, expect, test } from "bun:test";

import { savedSlugs } from "./wiki-health";

describe("savedSlugs", () => {
  test("reads the items a job saved", () => {
    expect(savedSlugs("saved: acme-billing, gotcha-x")).toEqual(["acme-billing", "gotcha-x"]);
  });
  test("a skip code, a note or nothing names no item", () => {
    expect(savedSlugs("NO_BOT")).toEqual([]);
    expect(savedSlugs("nothing to save")).toEqual([]);
    expect(savedSlugs("")).toEqual([]);
  });
});

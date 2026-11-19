import { expect, test } from "bun:test";

import { parseLessonsSearch, withLessonsSearch } from "./lessons-search";

const BOT = "00000000-0000-7000-8000-000000000001";

test("the address keeps only the filters it understands, and leaves the defaults out", () => {
  expect(parseLessonsSearch({})).toEqual({});
  expect(parseLessonsSearch({ tab: "suggestions" })).toEqual({ tab: "suggestions" });
  expect(parseLessonsSearch({ tab: "other" })).toEqual({});
  expect(
    parseLessonsSearch({
      find: "  refunds  ",
      label: "hurts",
      kind: "skill",
      sort: "best",
      bot: BOT,
      view: "archived",
    }),
  ).toEqual({
    find: "refunds",
    label: "hurts",
    kind: "skill",
    sort: "best",
    bot: BOT,
    view: "archived",
  });
  // What is not understood is dropped; "worst" is the default order, so it never shows in the address.
  expect(
    parseLessonsSearch({
      label: "great",
      kind: "folder",
      sort: "worst",
      bot: "not-an-id",
      view: "active",
      find: "   ",
      extra: 1,
    }),
  ).toEqual({});
});

test("a change drops an empty value from the address and keeps the rest", () => {
  const now = { label: "hurts", kind: "memory" } as const;
  expect(withLessonsSearch(now, { label: undefined })).toEqual({ kind: "memory" });
  expect(withLessonsSearch(now, { find: "billing", sort: "uses" })).toEqual({
    find: "billing",
    label: "hurts",
    kind: "memory",
    sort: "uses",
  });
});

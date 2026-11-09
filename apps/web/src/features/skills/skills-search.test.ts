import { expect, test } from "bun:test";
import { parseSkillsSearch, withSearch } from "./skills-search";

test("the address is read into the view, and anything not understood is dropped", () => {
  expect(parseSkillsSearch({})).toEqual({});
  expect(
    parseSkillsSearch({ tab: "market", q: " interview-me ", filter: "pdf", scope: "all" }),
  ).toEqual({
    tab: "market",
    q: "interview-me",
    filter: "pdf",
    scope: "all",
  });
  expect(
    parseSkillsSearch({ tab: "mine", q: "   ", filter: 3, scope: "everyone", extra: "x" }),
  ).toEqual({});
});

test("a change keeps the rest of the view and leaves empty values out of the address", () => {
  expect(withSearch({ tab: "market", q: "pdf" }, { filter: "make" })).toEqual({
    tab: "market",
    q: "pdf",
    filter: "make",
  });
  expect(withSearch({ tab: "market", q: "pdf", filter: "make" }, { filter: "" })).toEqual({
    tab: "market",
    q: "pdf",
  });
  expect(withSearch({ tab: "market", q: "pdf" }, { tab: undefined })).toEqual({ q: "pdf" });
  expect(
    withSearch({ tab: "market", q: "pdf" }, { q: "anthropics/skills", filter: undefined }),
  ).toEqual({
    tab: "market",
    q: "anthropics/skills",
  });
});

const BOT = "00000000-0000-7000-8000-000000000001";
test("the filters of My skills are read from the address; a value that is not understood is dropped", () => {
  expect(
    parseSkillsSearch({
      find: " pdf ",
      source: "github",
      sort: "used",
      bot: BOT,
      view: "archived",
      use: "unused",
    }),
  ).toEqual({
    find: "pdf",
    source: "github",
    sort: "used",
    bot: BOT,
    view: "archived",
    use: "unused",
  });
  expect(
    parseSkillsSearch({
      find: "  ",
      source: "svn",
      sort: "random",
      bot: "not-an-id",
      view: "all",
      use: "yes",
    }),
  ).toEqual({});
});

test("changing one filter keeps the others, and an empty value leaves the address", () => {
  const view = { find: "pdf", sort: "name" as const, use: "unused" as const };
  expect(withSearch(view, { source: "github" })).toEqual({ ...view, source: "github" });
  expect(withSearch(view, { use: undefined })).toEqual({ find: "pdf", sort: "name" });
  expect(withSearch(view, { find: "" })).toEqual({ sort: "name", use: "unused" });
});

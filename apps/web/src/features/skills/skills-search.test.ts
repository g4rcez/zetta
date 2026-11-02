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

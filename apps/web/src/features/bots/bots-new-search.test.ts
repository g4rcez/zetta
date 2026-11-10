import { expect, test } from "bun:test";
import { parseBotsNewSearch, withBotsNewSearch } from "./bots-new-search";

test("the plain address is the templates view", () => {
  expect(parseBotsNewSearch({})).toEqual({});
});

test("the address is read into the view, and anything not understood is dropped", () => {
  expect(
    parseBotsNewSearch({
      source: "grok",
      q: " research ",
      category: "Sales",
      grok: "dr-example-v2",
    }),
  ).toEqual({
    source: "grok",
    q: "research",
    category: "Sales",
    grok: "dr-example-v2",
  });
  expect(
    parseBotsNewSearch({ source: "other", q: "   ", category: 5, grok: "Not A Slug", extra: "x" }),
  ).toEqual({});
});

test("a chosen bot or a search without the Grok source is dropped: they mean nothing on their own", () => {
  expect(parseBotsNewSearch({ q: "research", category: "Sales", grok: "abc" })).toEqual({});
});

test("a bot id must look like a marketplace id", () => {
  expect(parseBotsNewSearch({ source: "grok", grok: "../../etc" })).toEqual({ source: "grok" });
  expect(parseBotsNewSearch({ source: "grok", grok: "UPPER" })).toEqual({ source: "grok" });
  expect(parseBotsNewSearch({ source: "grok", grok: "ok_id-1" })).toEqual({
    source: "grok",
    grok: "ok_id-1",
  });
});

test("long text is cut", () => {
  expect(parseBotsNewSearch({ source: "grok", q: "x".repeat(500) }).q).toHaveLength(100);
});

test("a change keeps the rest of the view and leaves empty values out of the address", () => {
  expect(withBotsNewSearch({ source: "grok", q: "research" }, { category: "Sales" })).toEqual({
    source: "grok",
    q: "research",
    category: "Sales",
  });
  expect(
    withBotsNewSearch({ source: "grok", q: "research", category: "Sales" }, { category: "" }),
  ).toEqual({ source: "grok", q: "research" });
});

test("going back to templates clears everything that belonged to the marketplace view", () => {
  expect(
    withBotsNewSearch(
      { source: "grok", q: "research", category: "Sales", grok: "abc" },
      { source: undefined },
    ),
  ).toEqual({});
});

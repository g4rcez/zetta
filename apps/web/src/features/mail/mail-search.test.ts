import { expect, test } from "bun:test";

import { parseMailSearch, withMailSearch } from "./mail-search";

test("the plain address is the default view", () => {
  expect(parseMailSearch({})).toEqual({});
  expect(parseMailSearch({ q: "   ", c: "" })).toEqual({});
});

test("a search and an open conversation are kept, and the search is trimmed", () => {
  expect(parseMailSearch({ q: "  invoice  ", c: "abc_DEF-123" })).toEqual({
    q: "invoice",
    c: "abc_DEF-123",
  });
});

test("what is not understood is dropped", () => {
  expect(parseMailSearch({ q: 7, c: 9 })).toEqual({});
  expect(parseMailSearch({ c: "has space" })).toEqual({});
  expect(parseMailSearch({ c: "a".repeat(2001) })).toEqual({});
  expect(parseMailSearch({ q: "x".repeat(500) }).q).toHaveLength(200);
});

test("a change keeps the rest and an empty value leaves the address", () => {
  expect(withMailSearch({ q: "a", c: "id1" }, { c: undefined })).toEqual({ q: "a" });
  expect(withMailSearch({ c: "id1" }, { q: "b", c: undefined })).toEqual({ q: "b" });
  expect(withMailSearch({ q: "a" }, { q: "" })).toEqual({});
});

test("the chat panel is open by default, so only closed and focus reach the address", () => {
  expect(parseMailSearch({ panel: "closed" })).toEqual({ panel: "closed" });
  expect(parseMailSearch({ panel: "focus", c: "id1" })).toEqual({ c: "id1", panel: "focus" });
  expect(parseMailSearch({ panel: "open" })).toEqual({});
  expect(parseMailSearch({ panel: "sideways" })).toEqual({});
  expect(parseMailSearch({ panel: true })).toEqual({});
  expect(withMailSearch({ panel: "closed", q: "a" }, { panel: undefined })).toEqual({ q: "a" });
  expect(withMailSearch({}, { panel: "focus" })).toEqual({ panel: "focus" });
});

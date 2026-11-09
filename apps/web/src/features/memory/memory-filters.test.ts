import { describe, expect, test } from "bun:test";

import {
  activeCount,
  searchQuery,
  filterOf,
  matches,
  mergeRows,
  parseMemorySearch,
  sortItems,
  tagCounts,
} from "./memory-filters";
import type { Item, Row, SharedRow } from "./memory-api";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const item = (o: Partial<Item>): Item => ({
  id: "i",
  slug: "s",
  title: "T",
  type: "owner",
  howto: "",
  tags: [],
  score: 50,
  status: "current",
  botAccess: "edit",
  access: "own",
  by: "user",
  ownerName: null,
  botId: null,
  authorBotId: null,
  teams: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...o,
});
const f = (search: Record<string, unknown>) => filterOf(parseMemorySearch(search));

describe("parseMemorySearch", () => {
  test("keeps valid values and drops the rest", () => {
    expect(
      parseMemorySearch({
        q: "  billing  ",
        type: "solo,nope,teams",
        tag: "a,b,a",
        status: "stale",
        access: "shared",
        by: "bot",
        bot: "01a199f7-6d0f-7f13-8518-1ffa91665d29",
        min: "20",
        max: 150,
        since: "30d",
        sort: "score",
        view: "graph",
        tagMode: "all",
      }),
    ).toEqual({
      q: "billing",
      view: "graph",
      type: "solo,teams",
      tag: "a,b",
      tagMode: "all",
      status: "stale",
      access: "shared",
      by: "bot",
      bot: "01a199f7-6d0f-7f13-8518-1ffa91665d29",
      min: 20,
      since: "30d",
      sort: "score",
    });
  });
  test("junk becomes an empty search", () => {
    expect(
      parseMemorySearch({
        q: "  ",
        type: "x",
        bot: "not-a-uuid",
        sort: "weird",
        min: "abc",
        since: "1y",
      }),
    ).toEqual({});
  });
  test("an empty score field is no limit, and 0 is a real limit", () => {
    expect(parseMemorySearch({ min: "", max: " " })).toEqual({});
    expect(parseMemorySearch({ min: "0", max: "0" })).toEqual({ min: 0, max: 0 });
  });
  test("tagMode all needs at least two tags", () => {
    expect(parseMemorySearch({ tag: "a", tagMode: "all" })).toEqual({ tag: "a" });
  });
});

describe("matches", () => {
  test("archived items are hidden unless the status filter asks for them", () => {
    const a = item({ status: "archived" });
    expect(matches(a, f({}), NOW)).toBe(false);
    expect(matches(a, f({ status: "archived" }), NOW)).toBe(true);
  });
  test("text looks in title, howto, slug and tags", () => {
    expect(matches(item({ tags: ["billing"] }), f({ q: "BILL" }), NOW)).toBe(true);
    expect(matches(item({ howto: "Use at month end" }), f({ q: "month" }), NOW)).toBe(true);
    expect(matches(item({ title: "Other" }), f({ q: "month" }), NOW)).toBe(false);
  });
  test("tags match any by default and all on request", () => {
    const i = item({ tags: ["a", "b"] });
    expect(matches(i, f({ tag: "a,z" }), NOW)).toBe(true);
    expect(matches(i, f({ tag: "a,z", tagMode: "all" }), NOW)).toBe(false);
    expect(matches(i, f({ tag: "a,b", tagMode: "all" }), NOW)).toBe(true);
  });
  test("createdBy keeps the items a bot created, not the ones it last wrote", () => {
    const bot = "01a199f7-6d0f-7f13-8518-1ffa91665d29";
    expect(parseMemorySearch({ createdBy: bot, by: "bot" })).toEqual({ createdBy: bot, by: "bot" });
    expect(parseMemorySearch({ createdBy: "nope" })).toEqual({});
    expect(matches(item({ authorBotId: bot }), f({ createdBy: bot }), NOW)).toBe(true);
    expect(
      matches(item({ authorBotId: null, botId: bot, by: "bot" }), f({ createdBy: bot }), NOW),
    ).toBe(false);
  });
  test("type, access, author, score range and age narrow the list", () => {
    expect(matches(item({ type: "solo" }), f({ type: "teams,owner" }), NOW)).toBe(false);
    expect(matches(item({ access: "shared" }), f({ access: "own" }), NOW)).toBe(false);
    expect(matches(item({ by: "bot" }), f({ by: "user" }), NOW)).toBe(false);
    expect(matches(item({ score: 79 }), f({ min: 80 }), NOW)).toBe(false);
    expect(matches(item({ score: 81 }), f({ max: 80 }), NOW)).toBe(false);
    expect(matches(item({ updatedAt: "2026-10-01T00:00:00Z" }), f({ since: "7d" }), NOW)).toBe(
      false,
    );
    expect(matches(item({ updatedAt: "2026-10-30T00:00:00Z" }), f({ since: "7d" }), NOW)).toBe(
      true,
    );
  });
  test("a team filter keeps only items of that team", () => {
    const team = "01a199f7-6d0f-7f13-8518-1ffa91665d29";
    expect(matches(item({ teams: [team] }), f({ team }), NOW)).toBe(true);
    expect(matches(item({ teams: [] }), f({ team }), NOW)).toBe(false);
  });
});

describe("sortItems", () => {
  const a = item({
    id: "a",
    title: "B",
    score: 10,
    updatedAt: "2026-11-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
  });
  const b = item({
    id: "b",
    title: "A",
    score: 90,
    updatedAt: "2026-10-01T00:00:00Z",
    createdAt: "2026-02-01T00:00:00Z",
  });
  test("relevance keeps the order the server gave", () => {
    expect(sortItems([a, b], "relevance").map((i) => i.id)).toEqual(["a", "b"]);
  });
  test("each sort orders as named", () => {
    expect(sortItems([b, a], "updated").map((i) => i.id)).toEqual(["a", "b"]);
    expect(sortItems([a, b], "created").map((i) => i.id)).toEqual(["b", "a"]);
    expect(sortItems([a, b], "score").map((i) => i.id)).toEqual(["b", "a"]);
    expect(sortItems([a, b], "title").map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("tagCounts, activeCount, mergeRows", () => {
  test("tags are counted, most used first", () => {
    expect(tagCounts([item({ tags: ["x", "y"] }), item({ tags: ["y"] })])).toEqual([
      { tag: "y", count: 2 },
      { tag: "x", count: 1 },
    ]);
  });
  test("the bot access filter parses, drops unknown levels, narrows the list and goes to the server", () => {
    expect(parseMemorySearch({ botAccess: "read,nope,suggest,read" })).toEqual({
      botAccess: "read,suggest",
    });
    expect(parseMemorySearch({ botAccess: "nope" })).toEqual({});
    const mine = item({ slug: "a", botAccess: "suggest" });
    const editable = item({ slug: "b", botAccess: "edit" });
    const shared = item({ slug: "c", botAccess: null, access: "shared" });
    const only = filterOf({ botAccess: "suggest,read" });
    expect(
      [mine, editable, shared].filter((i) => matches(i, only, NOW)).map((i) => i.slug),
    ).toEqual(["a"]);
    expect(activeCount(only)).toBe(1);
    expect(searchQuery({ q: "x", botAccess: "read" })).toBe("q=x&botAccess=read");
  });
  test("only narrowing facets count", () => {
    expect(activeCount(f({ q: "x", sort: "score", view: "graph" }))).toBe(0);
    expect(activeCount(f({ type: "solo", tag: "a", min: 10, max: 20, since: "7d" }))).toBe(4);
  });
  test("own and shared rows share one shape", () => {
    const own = {
      id: "1",
      slug: "a",
      title: "A",
      type: "owner",
      howto: "",
      tags: [],
      score: 50,
      status: "current",
      botAccess: "suggest",
      version: 1,
      authorBotId: null,
      updatedByBotId: "b1",
      teams: [],
      updatedBy: "bot",
      createdAt: "c",
      updatedAt: "u",
    } as Row;
    const shared = {
      id: "2",
      slug: "b",
      title: "B",
      type: "all",
      howto: "",
      tags: [],
      score: 50,
      status: "current",
      version: 1,
      ownerName: "Ana",
      createdAt: "c",
      updatedAt: "u",
    } as SharedRow;
    expect(
      mergeRows([own], [shared]).map((i) => [i.slug, i.access, i.by, i.botId, i.ownerName]),
    ).toEqual([
      ["a", "own", "bot", "b1", null],
      ["b", "shared", null, null, "Ana"],
    ]);
  });
});

describe("searchQuery", () => {
  test("only the facets that are set reach the query string", () => {
    expect(
      searchQuery(
        parseMemorySearch({
          q: "refund policy",
          tag: "a,b",
          tagMode: "all",
          min: "20",
          since: "7d",
        }),
      ),
    ).toBe("q=refund+policy&tag=a%2Cb&tagMode=all&min=20&since=7d");
    expect(searchQuery({})).toBe("");
  });
});

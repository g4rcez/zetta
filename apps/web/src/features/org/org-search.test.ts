import { describe, expect, test } from "bun:test";

import type { OrgPosition } from "./org-api";
import { filtering, matchesFilters, parseOrgSearch, toOrgSearch, toOrgState } from "./org-search";

const seat = (over: Partial<OrgPosition>): OrgPosition => ({
  id: "x",
  parentId: null,
  rank: "member",
  title: "Support agent",
  description: "",
  unit: "Support",
  sortOrder: 0,
  templateKey: null,
  seat: "open",
  holder: null,
  problem: null,
  team: null,
  ...over,
});

describe("the address of the organization page", () => {
  test("defaults stay out of the address and unknown values are dropped", () => {
    expect(parseOrgSearch({})).toEqual({});
    expect(parseOrgSearch({ view: "chart", show: "everyone", q: "  " })).toEqual({});
    expect(parseOrgSearch({ view: "grid", show: "robots", q: 4, focus: "not a uuid!" })).toEqual(
      {},
    );
  });

  test("the list view, a search, a group and a focused seat are kept", () => {
    const raw = {
      view: "list",
      q: "  tech ",
      show: "bots",
      focus: "01A1E09A-B559-7768-9BD5-8EF7142F77E2",
    };
    expect(parseOrgSearch(raw)).toEqual({
      view: "list",
      q: "tech",
      show: "bots",
      focus: "01a1e09a-b559-7768-9bd5-8ef7142f77e2",
    });
  });

  test("a long search is cut", () => {
    expect(parseOrgSearch({ q: "x".repeat(200) }).q).toHaveLength(80);
  });

  test("the state round-trips through the address", () => {
    expect(toOrgState({})).toEqual({ view: "chart", q: "", show: "everyone", focus: "" });
    const s = { view: "list", q: "ana", show: "people" } as const;
    expect(toOrgSearch(toOrgState(s))).toEqual(s);
    expect(toOrgSearch({ view: "chart", q: "", show: "everyone", focus: "" })).toEqual({});
  });
});

describe("pointing seats out", () => {
  test("a search reads the title, unit, holder and the one who held it", () => {
    const person = seat({
      seat: "person",
      holder: { kind: "person", userId: "u", name: "Ana Souza", avatar: null },
    });
    expect(matchesFilters(person, { q: "souza", show: "everyone" })).toBe(true);
    expect(matchesFilters(person, { q: "support", show: "everyone" })).toBe(true);
    expect(matchesFilters(person, { q: "finance", show: "everyone" })).toBe(false);
    const gone = seat({ problem: { code: "member_removed", was: "Rui", mine: false } });
    expect(matchesFilters(gone, { q: "rui", show: "everyone" })).toBe(true);
  });

  test("the group keeps only people or only bots", () => {
    const bot = seat({
      seat: "bot",
      holder: { kind: "bot", botId: "b", name: "Scribe", description: "", avatar: null },
    });
    const human = seat({
      seat: "person",
      holder: { kind: "person", userId: "u", name: "Ana", avatar: null },
    });
    expect(matchesFilters(bot, { q: "", show: "bots" })).toBe(true);
    expect(matchesFilters(human, { q: "", show: "bots" })).toBe(false);
    expect(matchesFilters(human, { q: "", show: "people" })).toBe(true);
    expect(matchesFilters(seat({}), { q: "", show: "people" })).toBe(false);
  });

  test("filtering is on only when something is asked", () => {
    expect(filtering({ q: "", show: "everyone" })).toBe(false);
    expect(filtering({ q: "a", show: "everyone" })).toBe(true);
    expect(filtering({ q: "", show: "bots" })).toBe(true);
  });
});

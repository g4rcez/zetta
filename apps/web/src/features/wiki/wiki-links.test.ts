import { describe, expect, test } from "bun:test";

import { appendLink, formatLink, insertLink, linkCandidates, matchWikiLink } from "./wiki-links";
import type { Item } from "./wiki-api";

const item = (o: Partial<Item>): Item => ({
  id: "i",
  slug: "s",
  title: "T",
  type: "owner",
  howto: "",
  tags: [],
  score: 50,
  status: "current",
  access: "own",
  by: "user",
  ownerName: null,
  botId: null,
  teams: [],
  createdAt: "c",
  updatedAt: "u",
  ...o,
});

describe("matchWikiLink", () => {
  test("finds the link being typed before the caret", () => {
    expect(matchWikiLink("see [[ac", 8)).toEqual({ relation: undefined, query: "ac", at: 4 });
    expect(matchWikiLink("see [[depends-on:ac", 19)).toEqual({
      relation: "depends-on",
      query: "ac",
      at: 4,
    });
    expect(matchWikiLink("[[", 2)).toEqual({ relation: undefined, query: "", at: 0 });
  });
  test("a finished link, a single bracket or a caret before the brackets is not a link being typed", () => {
    expect(matchWikiLink("see [[done]] more", 17)).toBeUndefined();
    expect(matchWikiLink("see [ac", 7)).toBeUndefined();
    expect(matchWikiLink("see [[ac", 3)).toBeUndefined();
  });
});

describe("formatLink, insertLink, appendLink", () => {
  test("a plain link has no prefix, a typed one has", () => {
    expect(formatLink("related", "a-b")).toBe("[[a-b]]");
    expect(formatLink("part-of", "a-b")).toBe("[[part-of:a-b]]");
  });
  test("insertLink replaces what was typed and keeps the rest", () => {
    expect(insertLink("see [[ac and more", 8, 4, "related", "acme")).toEqual({
      text: "see [[acme]] and more",
      caret: 12,
    });
    expect(insertLink("see [[ac]] more", 8, 4, "depends-on", "acme")).toEqual({
      text: "see [[depends-on:acme]] more",
      caret: 23,
    });
  });
  test("appendLink adds one line and never the same link twice", () => {
    expect(appendLink("Body.\n", "depends-on", "acme")).toBe(
      "Body.\n\nDepends on: [[depends-on:acme]]",
    );
    expect(appendLink("Body [[depends-on:acme]]", "depends-on", "acme")).toBe(
      "Body [[depends-on:acme]]",
    );
    expect(appendLink("Body [[acme]]", "depends-on", "acme")).toBe(
      "Body [[acme]]\n\nDepends on: [[depends-on:acme]]",
    );
  });
});

describe("linkCandidates", () => {
  const items = [
    item({ id: "1", slug: "acme-billing", title: "Acme billing", score: 40 }),
    item({ id: "2", slug: "billing-runbook", title: "Runbook", score: 90 }),
    item({ id: "3", slug: "other", title: "Billing notes", score: 10, status: "archived" }),
    item({ id: "4", slug: "self", title: "Billing self" }),
  ];
  test("prefix matches come first, then contains; archived, self and skipped items are left out", () => {
    expect(linkCandidates(items, "bill", "self").map((i) => i.slug)).toEqual([
      "billing-runbook",
      "acme-billing",
    ]);
    expect(
      linkCandidates(items, "bill", "self", new Set(["acme-billing"])).map((i) => i.slug),
    ).toEqual(["billing-runbook"]);
  });
  test("an empty query offers the most important items", () => {
    expect(linkCandidates(items, "", "self").map((i) => i.slug)).toEqual([
      "billing-runbook",
      "acme-billing",
    ]);
  });
  test("at most eight", () => {
    const many = Array.from({ length: 12 }, (_, n) =>
      item({ id: String(n), slug: `s${n}`, title: `S${n}` }),
    );
    expect(linkCandidates(many, "s")).toHaveLength(8);
  });
});

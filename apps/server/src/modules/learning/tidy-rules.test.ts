import { describe, expect, test } from "bun:test";
import {
  conflictingLessons,
  duplicateLessons,
  forbids,
  refHash,
  type LessonLite,
} from "./tidy-rules";

const L = (id: string, text: string, days = 0): LessonLite => ({
  id,
  text,
  createdAt: new Date(2026, 10, 1 + days),
});

describe("duplicateLessons", () => {
  test("two lessons with most of their words in common are the same; the older one comes first", () => {
    const pairs = duplicateLessons([
      L("new", "Always send the client reports as a table", 5),
      L("old", "Send client reports as a table", 0),
      L("other", "Use metric units"),
    ]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a.id, pairs[0]!.b.id]).toEqual(["old", "new"]);
    expect(pairs[0]!.score).toBeGreaterThanOrEqual(0.6);
  });
  test("one changed word is not enough, and a single lesson has no pair", () => {
    expect(
      duplicateLessons([L("a", "Send reports as a table"), L("b", "Send invoices as a table")]),
    ).toEqual([]);
    expect(duplicateLessons([L("a", "x lesson")])).toEqual([]);
  });
});

describe("conflictingLessons", () => {
  test("about the same thing, one forbids what the other asks: a pair to look at", () => {
    const pairs = conflictingLessons([
      L("a", "Send the sales report as a table", 0),
      L("b", "Never use a table for the sales report", 3),
    ]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a.id, pairs[0]!.b.id]).toEqual(["a", "b"]);
    const pt = conflictingLessons([
      L("a", "Mande o relatório de vendas em tabela"),
      L("b", "Nunca use tabela no relatório de vendas"),
    ]);
    expect(pt).toHaveLength(1);
  });
  test("two lessons that both forbid, both ask, or are about different things are not a pair", () => {
    expect(
      conflictingLessons([
        L("a", "Never use tables for sales"),
        L("b", "Never use colors for sales"),
      ]),
    ).toEqual([]);
    expect(
      conflictingLessons([L("a", "Send reports as a table"), L("b", "Send reports on Mondays")]),
    ).toEqual([]);
    expect(
      conflictingLessons([L("a", "Never answer late"), L("b", "Answer in Portuguese")]),
    ).toEqual([]);
  });
  test("the same lesson in other words is a duplicate, not a conflict", () => {
    expect(
      conflictingLessons([
        L("a", "Never send reports as text"),
        L("b", "Do not send reports as text, never"),
      ]),
    ).toEqual([]);
  });
});

describe("helpers", () => {
  test("what forbids, and the key of a suggestion", () => {
    for (const t of [
      "Never use X",
      "Don't use X",
      "Nunca use X",
      "Evite avoid X",
      "Sem tabelas",
      "Do not use X",
    ])
      expect(forbids(t)).toBe(true);
    expect(forbids("Always use X")).toBe(false);
    expect(refHash([{ id: "b" }, { id: "a" }])).toBe("a:b");
    expect(refHash([{ id: "a" }, { id: "b" }])).toBe(refHash([{ id: "b" }, { id: "a" }]));
  });
});

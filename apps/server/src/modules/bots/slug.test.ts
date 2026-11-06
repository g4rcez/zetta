import { describe, expect, test } from "bun:test";
import { SLUG_MAX, SLUG_RE, toSlug, withSuffix } from "./slug";

describe("bot slugs", () => {
  test.each([
    ["Choquei", "choquei"],
    ["Choquei Bot", "choquei"],
    ["choquei_bot", "choquei"],
    ["ChoqueiNews", "choquei-news"],
    ["HTMLParser", "html-parser"],
    ["Ação & Reação!", "acao-reacao"],
    ["  Müller's  Café ", "mullers-cafe"],
    ["123", "bot-123"],
    ["pg_admin", "bot-pg-admin"],
    ["Bot", "bot"],
    ["🚀", "bot"],
    ["ロボット", "bot"],
    ['x"; drop schema public; --', "x-drop-schema-public"],
  ])("%p -> %p", (name, slug) => {
    expect(toSlug(name)).toBe(slug);
    expect(slug).toMatch(SLUG_RE);
  });

  test("long names are cut on a word boundary", () => {
    const s = toSlug("The quick brown fox jumps over the lazy dog again and again and again");
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(s).toMatch(SLUG_RE);
    expect(s.endsWith("-")).toBe(false);
  });

  test("suffixes stay valid and within the limit", () => {
    expect(withSuffix("choquei", 1)).toBe("choquei");
    expect(withSuffix("choquei", 2)).toBe("choquei-2");
    const long = toSlug("a".repeat(80));
    expect(withSuffix(long, 12).length).toBeLessThanOrEqual(SLUG_MAX);
    expect(withSuffix(long, 12)).toMatch(SLUG_RE);
  });
});

import { describe, expect, test } from "bun:test";
import { assertIdent, schemaFor, SLUG_MAX, SLUG_RE, toSlug, withSuffix } from "./naming";

describe("bot database naming", () => {
  test.each([
    ["Choquei", "choquei", "choquei_bot"],
    ["Choquei Bot", "choquei", "choquei_bot"],
    ["choquei_bot", "choquei", "choquei_bot"],
    ["ChoqueiNews", "choquei-news", "choquei_news_bot"],
    ["HTMLParser", "html-parser", "html_parser_bot"],
    ["Ação & Reação!", "acao-reacao", "acao_reacao_bot"],
    ["  Müller's  Café ", "mullers-cafe", "mullers_cafe_bot"],
    ["123", "bot-123", "bot_123_bot"],
    ["pg_admin", "bot-pg-admin", "bot_pg_admin_bot"],
    ["Bot", "bot", "bot_bot"],
    ["🚀", "bot", "bot_bot"],
    ["ロボット", "bot", "bot_bot"],
    ['x"; drop schema public; --', "x-drop-schema-public", "x_drop_schema_public_bot"],
  ])("%p -> %p", (name, slug, schema) => {
    expect(toSlug(name)).toBe(slug);
    expect(schemaFor(slug)).toBe(schema);
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

  test("distinct slugs give distinct schemas", () => {
    const slugs = ["a-b", "ab", "a-bot", "a", "a-b-2", "a-b2"];
    expect(new Set(slugs.map(schemaFor)).size).toBe(slugs.length);
  });

  test("identifiers that could escape quoting are refused", () => {
    for (const bad of ['a"_bot', "a;_bot", "A_bot", "pg_x_bot", "x", "_bot", "a b_bot", `${"a".repeat(60)}_bot`]) expect(() => assertIdent(bad)).toThrow();
    for (const bad of ["Choquei", "a_b", "pg-x", "-a", ""]) expect(() => schemaFor(bad)).toThrow();
  });
});

import { describe, expect, test } from "bun:test";

import { getCopy } from "../i18n";
import { pageMarkdown } from "./page-md";

describe("pageMarkdown", () => {
  const en = pageMarkdown("en");
  const pt = pageMarkdown("pt-br");

  test("starts with the page's own headline", () => {
    expect(en.startsWith("# Ask for the result. Zetta does the rest.\n")).toBe(true);
    expect(pt.startsWith("# Peça o resultado.")).toBe(true);
  });

  test("carries the install command and the repository links", () => {
    expect(en).toContain("curl -fsSL https://zettabot.app/install | bash");
    expect(en).toContain("https://github.com/g4rcez/zetta");
  });

  test("has every question and answer of the FAQ, in each language", () => {
    for (const locale of ["en", "pt-br"] as const) {
      const md = pageMarkdown(locale);
      for (const f of getCopy(locale).faq.items) {
        expect(md).toContain(`### ${f.q}`);
        expect(md).toContain(f.a);
      }
    }
  });

  test("has every feature, step and capability the page shows", () => {
    const c = getCopy("en");
    for (const t of c.features.tiles) expect(en).toContain(t.title);
    for (const s of c.install.steps) expect(en).toContain(s.title);
    for (const k of c.chief.caps) expect(en).toContain(k.title);
  });

  test("a statement is a paragraph, never a heading", () => {
    const c = getCopy("en");
    expect(en).toContain(`\n${c.pain.before}${c.pain.mark}`);
    expect(en).not.toContain(`## ${c.pain.before}`);
  });

  test("has no pictures, no HTML and no unfilled template text", () => {
    for (const md of [en, pt]) {
      expect(md).not.toMatch(/!\[/);
      expect(md).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(md).not.toContain("undefined");
      expect(md).not.toMatch(/\n{3,}/);
      expect(md.endsWith("\n")).toBe(true);
    }
  });
});

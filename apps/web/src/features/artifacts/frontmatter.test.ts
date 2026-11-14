import { describe, expect, test } from "bun:test";
import { splitFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  test("separates the fields from the body", () => {
    const out = splitFrontmatter(
      "---\nname: humanizar\ndescription: Reescreve um texto\n---\n\n# Titulo\n\nTexto",
    );
    expect(out.fields).toEqual([
      { key: "name", value: "humanizar" },
      { key: "description", value: "Reescreve um texto" },
    ]);
    expect(out.body).toBe("# Titulo\n\nTexto");
  });
  test("joins continuation lines and folded blocks, unquotes values", () => {
    const out = splitFrontmatter(
      '---\ndescription: >\n  first line\n  second line\nmodel: "opus"\ntools: a, b\n---\nbody',
    );
    expect(out.fields).toEqual([
      { key: "description", value: "first line second line" },
      { key: "model", value: "opus" },
      { key: "tools", value: "a, b" },
    ]);
    expect(out.body).toBe("body");
  });
  test("keeps line breaks of a literal block", () => {
    expect(splitFrontmatter("---\nnote: |\n  a\n  b\n---\nx").fields[0]!.value).toBe("a\nb");
  });
  test("handles CRLF", () => {
    const out = splitFrontmatter("---\r\nname: x\r\n---\r\nbody");
    expect(out).toEqual({ fields: [{ key: "name", value: "x" }], body: "body" });
  });
  test("leaves a file without frontmatter alone", () => {
    const text = "# Title\n\n---\n\nname: not frontmatter\n---\n";
    expect(splitFrontmatter(text)).toEqual({ fields: [], body: text });
  });
  test("a horizontal rule pair that holds no key: value is not frontmatter", () => {
    const text = "---\njust a line\n---\nrest";
    expect(splitFrontmatter(text)).toEqual({ fields: [], body: text });
  });
});

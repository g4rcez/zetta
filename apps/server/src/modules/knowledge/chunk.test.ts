import { describe, expect, test } from "bun:test";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  test("keeps short text whole and drops blank text", () => {
    expect(chunkText("  Hello   world \r\n")).toEqual(["Hello world"]);
    expect(chunkText(" \n\n ")).toEqual([]);
  });
  test("cuts long text at a sentence end, with overlap, and loses nothing", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} ends here.`).join(" ");
    const chunks = chunkText(text, 200, 40);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.slice(0, -1).every((c) => c.endsWith("."))).toBe(true);
    expect(chunks[0]!.startsWith("Sentence number 0")).toBe(true);
    expect(chunks.at(-1)!.endsWith("Sentence number 39 ends here.")).toBe(true);
    for (let i = 0; i < 40; i++)
      expect(chunks.some((c) => c.includes(`number ${i} ends`))).toBe(true);
  });
  test("terminates on text with no break points", () => {
    expect(chunkText("x".repeat(5000), 1500, 150).length).toBe(4);
  });
});

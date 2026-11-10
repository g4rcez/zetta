import { describe, expect, test } from "bun:test";
import { applyRedaction, contentHash, looksSecret, matches, pieces, safeRegex } from "./safety";

describe("safeRegex", () => {
  test("accepts ordinary patterns and rejects risky or invalid ones", () => {
    expect(safeRegex("\\d{4}-\\d{4}")).toBeInstanceOf(RegExp);
    for (const bad of [
      "(a+)+$",
      "(a|aa)+",
      "(.*)*x",
      "(x+x+)+y",
      "\\1",
      "(?=a)",
      "[",
      "x".repeat(101),
      "",
    ])
      expect(safeRegex(bad)).toBeUndefined();
  });
  test("catastrophic patterns (including ones the static filter misses) cannot hang the process", async () => {
    for (const p of ["((a))+b", "(a?){30}a{30}b", "a*a*a*a*a*b", "(a|a?)+b", "(x+x+)+y"]) {
      const start = Date.now();
      expect(await matches("a".repeat(40) + "c", p)).toBe(false);
      expect(Date.now() - start).toBeLessThan(1500);
    }
    // the event loop stays responsive and normal patterns still work afterwards
    expect(await matches("card 1234-5678", "\\d{4}-\\d{4}")).toBe(true);
  });
  test("a pattern that times out is blacklisted for the process", async () => {
    const p = "(a*)*(a*)*(a*)*b";
    await applyRedaction("a".repeat(30) + "c", p, "x");
    const start = Date.now();
    expect((await applyRedaction("a".repeat(30) + "c", p, "x")).ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(50);
  });
  test("redaction replaces matches and reports invalid patterns", async () => {
    expect(await applyRedaction("card 1234-5678 ok", "\\d{4}-\\d{4}", "[card]")).toEqual({
      text: "card [card] ok",
      ok: true,
    });
    expect((await applyRedaction("x", "(a+)+$", "y")).ok).toBe(false);
  });
  const long = "word ".repeat(5000) + "card 1234-5678 end";
  test("redaction reaches text past the first 20,000 characters", async () => {
    const r = await applyRedaction(long, "\\d{4}-\\d{4}", "[card]");
    expect(r.ok).toBe(true);
    expect(r.text.endsWith("card [card] end")).toBe(true);
    expect(r.text).not.toContain("1234-5678");
  });
  test("a stop pattern is found past the first 20,000 characters", async () => {
    expect(await matches(long, "\\d{4}-\\d{4}")).toBe(true);
    expect(await matches("word ".repeat(5000), "\\d{4}-\\d{4}")).toBe(false);
  });
  test("text is cut into pieces of at most the limit, at a line break when there is one", () => {
    const t = ("x".repeat(99) + "\n").repeat(450);
    const ps = pieces(t);
    expect(ps.every((p) => p.length <= 20000)).toBe(true);
    expect(ps.join("")).toBe(t);
    expect(ps.slice(0, -1).every((p) => p.endsWith("\n"))).toBe(true);
  });
  test("text with no break is cut hard and still joins back", () => {
    const u = "y".repeat(50001);
    const ps = pieces(u);
    expect(ps.join("")).toBe(u);
    expect(ps.length).toBe(3);
  });
  test("short text is one piece", () => {
    expect(pieces("abc")).toEqual(["abc"]);
    expect(pieces("")).toEqual([""]);
  });
});
describe("looksSecret", () => {
  test("flags credentials but not normal facts", () => {
    for (const s of [
      "my key is sk-abcdefghijklmnop1234",
      "AKIAABCDEFGHIJKLMNOP",
      "password: hunter22222",
      "ghp_abcdefghijklmnopqrstuvwx",
      "-----BEGIN RSA PRIVATE KEY-----",
      "a".repeat(10) + "0123456789abcdef".repeat(3),
    ])
      expect(looksSecret(s)).toBe(true);
    for (const s of ["prefers metric units", "lives in Lisbon", "standup is at 10:00"])
      expect(looksSecret(s)).toBe(false);
  });
  test("contentHash normalizes case and whitespace", () => {
    expect(contentHash("Likes  Tea")).toBe(contentHash("likes tea"));
    expect(contentHash("a", "b")).not.toBe(contentHash("ab"));
  });
});

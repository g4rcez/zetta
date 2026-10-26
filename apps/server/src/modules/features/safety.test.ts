import { describe, expect, test } from "bun:test";
import { applyRedaction, contentHash, looksSecret, matches, safeRegex } from "./safety";

describe("safeRegex", () => {
  test("accepts ordinary patterns and rejects risky or invalid ones", () => {
    expect(safeRegex("\\d{4}-\\d{4}")).toBeInstanceOf(RegExp);
    for (const bad of ["(a+)+$", "(a|aa)+", "(.*)*x", "(x+x+)+y", "\\1", "(?=a)", "[", "x".repeat(101), ""]) expect(safeRegex(bad)).toBeUndefined();
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
    const start = Date.now(); expect((await applyRedaction("a".repeat(30) + "c", p, "x")).ok).toBe(false); expect(Date.now() - start).toBeLessThan(50);
  });
  test("redaction replaces matches and reports invalid patterns", async () => {
    expect(await applyRedaction("card 1234-5678 ok", "\\d{4}-\\d{4}", "[card]")).toEqual({ text: "card [card] ok", ok: true });
    expect((await applyRedaction("x", "(a+)+$", "y")).ok).toBe(false);
  });
});
describe("looksSecret", () => {
  test("flags credentials but not normal facts", () => {
    for (const s of ["my key is sk-abcdefghijklmnop1234", "AKIAABCDEFGHIJKLMNOP", "password: hunter22222", "ghp_abcdefghijklmnopqrstuvwx", "-----BEGIN RSA PRIVATE KEY-----", "a".repeat(10) + "0123456789abcdef".repeat(3)])
      expect(looksSecret(s)).toBe(true);
    for (const s of ["prefers metric units", "lives in Lisbon", "standup is at 10:00"]) expect(looksSecret(s)).toBe(false);
  });
  test("contentHash normalizes case and whitespace", () => { expect(contentHash("Likes  Tea")).toBe(contentHash("likes tea")); expect(contentHash("a", "b")).not.toBe(contentHash("ab")); });
});

import { describe, expect, test } from "bun:test";
import {
  approxTokens,
  CHAT_MEMORY,
  draftOf,
  memoryChanged,
  parseMemoryDraft,
  type MemoryDraft,
} from "./chat-memory";

const blank: MemoryDraft = {
  contextBytes: "",
  summaryMaxChars: "",
  summaryGapBytes: "",
  chatSearchLimit: "",
  summaryMode: "chief",
};

describe("parseMemoryDraft", () => {
  test("an empty draft is every default", () => {
    expect(parseMemoryDraft(blank)).toEqual({
      ok: true,
      patch: {
        contextBytes: null,
        summaryMaxChars: null,
        summaryGapBytes: null,
        chatSearchLimit: null,
        summaryMode: "chief",
      },
    });
  });
  test("typed numbers become numbers, with or without a thousands separator", () => {
    const r = parseMemoryDraft({
      ...blank,
      contextBytes: "40,000",
      summaryMaxChars: "3 500",
      summaryGapBytes: "20_000",
      chatSearchLimit: "3",
      summaryMode: "bot",
    });
    expect(r).toEqual({
      ok: true,
      patch: {
        contextBytes: 40_000,
        summaryMaxChars: 3_500,
        summaryGapBytes: 20_000,
        chatSearchLimit: 3,
        summaryMode: "bot",
      },
    });
    expect(parseMemoryDraft({ ...blank, contextBytes: "24.000" })).toMatchObject({
      ok: true,
      patch: { contextBytes: 24_000 },
    });
  });
  test("each field says what is wrong and what the limits are", () => {
    const r = parseMemoryDraft({
      ...blank,
      contextBytes: "3999",
      summaryMaxChars: "6001",
      summaryGapBytes: "abc",
      chatSearchLimit: "2.5",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual([
      "chatSearchLimit",
      "contextBytes",
      "summaryGapBytes",
      "summaryMaxChars",
    ]);
    expect(r.errors.contextBytes).toBe(
      "How much of the chat it reads back must be between 4,000 and 60,000.",
    );
    expect(r.errors.chatSearchLimit).toContain("whole number between 1 and 10");
  });
  test("the edges are in range", () => {
    for (const [k, range] of Object.entries(CHAT_MEMORY)) {
      for (const n of [range.min, range.max])
        expect(parseMemoryDraft({ ...blank, [k]: String(n) }).ok).toBe(true);
      expect(parseMemoryDraft({ ...blank, [k]: String(range.max + 1) }).ok).toBe(false);
      expect(parseMemoryDraft({ ...blank, [k]: String(range.min - 1) }).ok).toBe(false);
    }
  });
});

describe("memoryChanged and the helpers", () => {
  test("a draft equal to what the bot has is not a change", () => {
    expect(memoryChanged(blank, {})).toBe(false);
    expect(memoryChanged({ ...blank, contextBytes: "40000" }, { contextBytes: 40_000 })).toBe(
      false,
    );
    expect(memoryChanged({ ...blank, contextBytes: "40000" }, { contextBytes: null })).toBe(true);
    expect(memoryChanged({ ...blank, summaryMode: "off" }, { summaryMode: "chief" })).toBe(true);
    expect(memoryChanged(blank, { chatSearchLimit: 4 })).toBe(true);
  });
  test("tokens are about a quarter of the bytes; an empty field is the default", () => {
    expect(approxTokens(24_000)).toBe(6_000);
    expect(draftOf(null)).toBe("");
    expect(draftOf(8_000)).toBe("8000");
  });
});

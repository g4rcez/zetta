import { describe, expect, test } from "bun:test";

import { draftKey, readDraft, writeDraft } from "./use-draft";

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
};

describe("draft storage", () => {
  test("round-trips per key and removes empty drafts", () => {
    const s = memory();
    writeDraft("c:1", "hello", s);
    writeDraft("c:2", "other", s);
    expect(readDraft("c:1", s)).toBe("hello");
    expect(readDraft("c:2", s)).toBe("other");
    writeDraft("c:1", "", s);
    expect(readDraft("c:1", s)).toBe("");
    expect(s.m.size).toBe(1);
  });
  test("never throws when storage fails or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(readDraft("c:1", broken)).toBe("");
    expect(() => writeDraft("c:1", "x", broken)).not.toThrow();
    expect(readDraft("c:1", undefined)).toBe("");
    expect(readDraft(undefined, memory())).toBe("");
  });
  test("keys prefer the conversation over the bot", () => {
    expect(draftKey("b", "c")).toBe("c:c");
    expect(draftKey("b")).toBe("b:b");
    expect(draftKey()).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import {
  buildHistory,
  chatSearchLimit,
  clipBytes,
  fitHistory,
  PROMPT_MAX_BYTES,
  summaryChars,
  summaryGap,
  summaryMode,
} from "./context";

const m = (
  id: string,
  role: string,
  content: string,
  parentMessageId: string | null = null,
  status = "complete",
) => ({ id, role, content, parentMessageId, status });
describe("buildHistory", () => {
  const h = [
    m("1", "user", "main one"),
    m("2", "assistant", "main two"),
    m("3", "user", "thread A reply", "1"),
    m("4", "user", "thread B reply", "2"),
    m("5", "assistant", "failed", null, "failed"),
  ];
  test("main line excludes threads and failed messages", () => {
    expect(buildHistory(h).messages.map((x) => x.content)).toEqual(["main one", "main two"]);
  });
  test("a thread sees its root and own replies, never siblings", () => {
    expect(buildHistory(h, { parentMessageId: "1" }).messages.map((x) => x.content)).toEqual([
      "main one",
      "thread A reply",
    ]);
  });
  test("keeps the newest messages within the byte budget and reports truncation", () => {
    const big = Array.from({ length: 50 }, (_, i) =>
      m(String(i), "user", `message-${i}-` + "x".repeat(100)),
    );
    const r = buildHistory(big, { budget: 500 });
    expect(r.truncated).toBe(true);
    expect(r.messages.at(-1)!.content).toContain("message-49");
    expect(r.messages.reduce((n, x) => n + Buffer.byteLength(x.content), 0)).toBeLessThanOrEqual(
      500,
    );
  });
  test("a single oversized message is clipped rather than dropped", () => {
    const r = buildHistory([m("1", "user", "y".repeat(5000))], { budget: 100 });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.content.length).toBeLessThanOrEqual(100);
  });
});

describe("pictures in the history", () => {
  test("a message with pictures is tagged by name, and a picture-only message is still kept", () => {
    const { messages } = buildHistory([
      { id: "1", role: "user", content: "this is the receipt", images: ["receipt.png"] },
      { id: "2", role: "user", content: "", images: ["a.png", "b]\n.png"] },
    ]);
    expect(messages[0]!.content).toBe("this is the receipt\n[image: receipt.png]");
    expect(messages[1]!.content).toBe("[image: a.png]\n[image: b  .png]");
  });
});

describe("clipBytes", () => {
  test("cuts at a number of bytes and never in the middle of a character", () => {
    expect(clipBytes("hello", 3)).toBe("hel");
    expect(clipBytes("hello", 99)).toBe("hello");
    expect(clipBytes("hello", 0)).toBe("");
    // Three bytes each: 4 bytes hold one character, never a broken half of the second.
    expect(clipBytes("漢字漢字", 4)).toBe("漢");
    expect(Buffer.byteLength(clipBytes("😀😀😀", 6))).toBeLessThanOrEqual(6);
    expect(clipBytes("😀😀😀", 6)).toBe("😀");
  });
  test("one message larger than the budget is cut by bytes, so multibyte text cannot overflow it", () => {
    const big = "漢".repeat(50_000); // 150,000 bytes
    const { messages, truncated } = buildHistory([{ id: "1", role: "user", content: big }], {
      budget: 4_000,
    });
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(messages[0]!.content)).toBeLessThanOrEqual(4_000);
  });
});

describe("fitHistory", () => {
  const msgs = (n: number, size: number) =>
    Array.from({ length: n }, (_, i) => ({ role: "user", content: `${i}`.padEnd(size, "x") }));
  test("keeps everything that fits", () => {
    const r = fitHistory(msgs(5, 100), 1_000, 10_000);
    expect(r.dropped).toBe(0);
    expect(r.messages).toHaveLength(5);
  });
  test("drops the oldest messages first until the whole prompt fits", () => {
    const past = msgs(10, 1_000);
    const r = fitHistory(past, 5_000, 12_000);
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.messages.at(-1)).toEqual(past.at(-1)!);
    expect(r.messages[0]).toEqual(past[past.length - r.messages.length]!);
    const total =
      5_000 + r.messages.reduce((n, x) => n + Buffer.byteLength(`${x.role}: ${x.content}`) + 1, 0);
    expect(total).toBeLessThanOrEqual(12_000);
  });
  test("when even the newest message is too big it stays, clipped, and the prompt still fits", () => {
    const r = fitHistory(
      [{ role: "user", content: "漢".repeat(50_000) }],
      100_000,
      PROMPT_MAX_BYTES,
    );
    expect(r.messages).toHaveLength(1);
    const total = 100_000 + Buffer.byteLength(`user: ${r.messages[0]!.content}`) + 1;
    expect(total).toBeLessThanOrEqual(PROMPT_MAX_BYTES);
  });
  test("a prompt that leaves no room at all keeps an empty newest message, never a crash", () => {
    const r = fitHistory([{ role: "user", content: "hello" }], 200_000);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.content).toBe("");
  });
});

describe("the other memory settings", () => {
  test("null and missing mean the default; values are kept inside their limits", () => {
    expect(summaryMode({})).toBe("chief");
    expect(summaryMode({ summaryMode: "off" })).toBe("off");
    expect(summaryMode({ summaryMode: "bot" })).toBe("bot");
    expect(summaryMode({ summaryMode: "nonsense" })).toBe("chief");
    expect(summaryChars({})).toBe(2_000);
    expect(summaryChars({ summaryMaxChars: 1 })).toBe(500);
    expect(summaryChars({ summaryMaxChars: 99_999 })).toBe(6_000);
    expect(summaryGap({ summaryGapBytes: null })).toBe(2_000);
    expect(summaryGap({ summaryGapBytes: 20_000 })).toBe(20_000);
    expect(chatSearchLimit({})).toBe(6);
    expect(chatSearchLimit({ chatSearchLimit: 0 })).toBe(1);
    expect(chatSearchLimit({ chatSearchLimit: 50 })).toBe(10);
  });
});

import { describe, expect, test } from "bun:test";
import { buildHistory } from "./context";

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

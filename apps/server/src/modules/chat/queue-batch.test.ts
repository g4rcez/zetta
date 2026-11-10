import { describe, expect, test } from "bun:test";

import { batchPrompt, joinPicks, pickBatch, type Waiting } from "./queue-batch";

const row = (id: string, thread: string | null = null, size = 10): Waiting => ({
  id,
  messageId: `m-${id}`,
  thread,
  size,
});

describe("pickBatch", () => {
  test("nothing waits: no batch", () => {
    expect(pickBatch([])).toBeUndefined();
  });

  test("one message is its own anchor", () => {
    expect(pickBatch([row("a")])).toEqual({ anchor: row("a"), earlier: [] });
  });

  test("every waiting message of the thread is answered together; the newest is the anchor", () => {
    const got = pickBatch([row("a"), row("b"), row("c")]);
    expect(got?.anchor.id).toBe("c");
    expect(got?.earlier.map((w) => w.id)).toEqual(["a", "b"]);
  });

  test("a message of another thread waits for its own turn", () => {
    const got = pickBatch([row("a"), row("t1", "thread-1"), row("b")]);
    expect(got?.anchor.id).toBe("b");
    expect(got?.earlier.map((w) => w.id)).toEqual(["a"]);
  });

  test("the oldest message decides the thread, even when it is a thread reply", () => {
    const got = pickBatch([row("t1", "thread-1"), row("a"), row("t2", "thread-1")]);
    expect(got?.anchor.id).toBe("t2");
    expect(got?.earlier.map((w) => w.id)).toEqual(["t1"]);
  });

  test("the caps leave the rest for the next turn, in order", () => {
    const byCount = pickBatch([row("a"), row("b"), row("c")], { messages: 2, chars: 1000 });
    expect(byCount?.anchor.id).toBe("b");
    const bySize = pickBatch([row("a", null, 60), row("b", null, 60), row("c", null, 10)], {
      messages: 10,
      chars: 100,
    });
    // "b" does not fit, and "c" must not jump over it.
    expect(bySize?.anchor.id).toBe("a");
    expect(bySize?.earlier).toEqual([]);
  });

  test("an oversized first message is still answered", () => {
    expect(pickBatch([row("a", null, 999)], { messages: 5, chars: 100 })?.anchor.id).toBe("a");
  });
});

describe("batchPrompt", () => {
  test("one message reads exactly as it was typed", () => {
    expect(batchPrompt([{ content: "deploy it" }])).toBe("deploy it");
    expect(batchPrompt([{ content: "yes", quote: "> earlier" }])).toBe("> earlier\n\nyes");
  });

  test("several messages are numbered in order and the bot is told the latest wins", () => {
    const text = batchPrompt([
      { content: "send the report to Ana" },
      { content: "actually send it to Bruno", quote: "> the report" },
      { content: "and add the chart" },
    ]);
    expect(text).toContain("3 messages");
    expect(text).toContain("the latest instruction wins");
    const [one, two, three] = [
      text.indexOf("Message 1 of 3:\nsend the report to Ana"),
      text.indexOf("Message 2 of 3:\n> the report\n\nactually send it to Bruno"),
      text.indexOf("Message 3 of 3:\nand add the chart"),
    ];
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
  });
});

describe("joinPicks", () => {
  test("joins the picks of every message once, in first-named order", () => {
    expect(
      joinPicks([
        { fileRefs: ["a.md"], memoryIds: ["m1"], skills: [] },
        null,
        { fileRefs: ["b.md", "a.md"], skills: ["review"] },
        { memoryIds: ["m1", "m2"], skills: ["review", 7] },
      ]),
    ).toEqual({ fileRefs: ["a.md", "b.md"], memoryIds: ["m1", "m2"], skills: ["review"] });
  });
});

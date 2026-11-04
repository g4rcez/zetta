import { describe, expect, test } from "bun:test";
import type { ChatEvent } from "./service";
import { toUIMessageStream } from "./ui-stream";

type Saved = Extract<ChatEvent, { type: "message" }>["message"];
const row = (
  id: string,
  role: "user" | "assistant",
  content: string,
  seq: number,
  botId: string | null = null,
): Saved => ({
  id,
  ownerInstance: null,
  conversationId: "c",
  ownerUserId: "u",
  seq,
  role,
  content,
  status: "complete",
  clientRequestId: null,
  mentions: null,
  meta: null,
  botVersion: null,
  parentMessageId: null,
  botId,
  createdAt: new Date(0),
});

async function chunks(events: ChatEvent[] | (() => AsyncGenerator<ChatEvent>)) {
  const source =
    typeof events === "function"
      ? events()
      : (async function* () {
          yield* events;
        })();
  const out: {
    type: string;
    id?: string;
    delta?: string;
    data?: unknown;
    transient?: boolean;
    errorText?: string;
  }[] = [];
  for await (const c of toUIMessageStream(source) as unknown as AsyncIterable<(typeof out)[number]>)
    out.push(c);
  return out;
}

describe("toUIMessageStream", () => {
  test("two speakers become successive data-speaker segments of one assistant message", async () => {
    const user = row("u1", "user", "@a @b hi", 1);
    const a = row("m1", "assistant", "hello from a", 2, "bot-a");
    const b = row("m2", "assistant", "hello from b", 3, "bot-b");
    const out = await chunks([
      { type: "user", message: user },
      { type: "start", messageId: "m1", botId: "bot-a", botName: "A" },
      { type: "delta", messageId: "m1", botId: "bot-a", text: "hello " },
      { type: "delta", messageId: "m1", botId: "bot-a", text: "from a" },
      { type: "message", message: a, botName: "A" },
      { type: "proposal", proposalId: "p1" },
      { type: "start", messageId: "m2", botId: "bot-b", botName: "B" },
      { type: "delta", messageId: "m2", botId: "bot-b", text: "hello from b" },
      { type: "message", message: b, botName: "B" },
      { type: "summary", text: "Delegation: A, B" },
      { type: "done" },
    ]);
    expect(out.map((c) => (c.id ? `${c.type}:${c.id}` : c.type))).toEqual([
      "start",
      "data-user-saved:u1",
      "data-speaker:m1",
      "text-start:m1",
      "text-delta:m1",
      "text-delta:m1",
      "text-end:m1",
      "data-saved:m1",
      "data-proposal:p1",
      "data-speaker:m2",
      "text-start:m2",
      "text-delta:m2",
      "text-end:m2",
      "data-saved:m2",
      "data-summary",
      "finish",
    ]);
    expect(out.find((c) => c.type === "data-speaker" && c.id === "m2")?.data).toEqual({
      messageId: "m2",
      botId: "bot-b",
      botName: "B",
    });
    expect(
      out
        .filter((c) => c.id === "m1" && c.type === "text-delta")
        .map((c) => c.delta)
        .join(""),
    ).toBe("hello from a");
    expect(out.find((c) => c.type === "data-saved" && c.id === "m2")?.data).toEqual({
      message: b,
      botName: "B",
    });
    expect(out.find((c) => c.type === "data-summary")?.data).toEqual({ text: "Delegation: A, B" });
  });

  test("replies that stream at the same time keep their text apart", async () => {
    const a = row("m1", "assistant", "A", 2, "bot-a");
    const b = row("m2", "assistant", "B", 3, "bot-b");
    const out = await chunks([
      { type: "start", messageId: "m1", botId: "bot-a", botName: "A" },
      { type: "start", messageId: "m2", botId: "bot-b", botName: "B" },
      { type: "delta", messageId: "m1", botId: "bot-a", text: "A" },
      { type: "delta", messageId: "m2", botId: "bot-b", text: "B" },
      { type: "message", message: b, botName: "B" },
      { type: "message", message: a, botName: "A" },
      { type: "done" },
    ]);
    expect(out.map((c) => (c.id ? `${c.type}:${c.id}` : c.type))).toEqual([
      "start",
      "data-speaker:m1",
      "text-start:m1",
      "data-speaker:m2",
      "text-start:m2",
      "text-delta:m1",
      "text-delta:m2",
      "text-end:m2",
      "data-saved:m2",
      "text-end:m1",
      "data-saved:m1",
      "finish",
    ]);
    expect(out.filter((c) => c.type === "text-delta").map((c) => [c.id, c.delta])).toEqual([
      ["m1", "A"],
      ["m2", "B"],
    ]);
  });

  test("a replayed reply without start/delta still yields a full text part", async () => {
    const a = row("m1", "assistant", "already answered", 2, "bot-a");
    const out = await chunks([{ type: "message", message: a, botName: "" }, { type: "done" }]);
    expect(out.map((c) => c.type)).toEqual([
      "start",
      "data-speaker",
      "text-start",
      "text-delta",
      "text-end",
      "data-saved",
      "finish",
    ]);
    expect(out.find((c) => c.type === "text-delta")?.delta).toBe("already answered");
  });

  test("a published artifact becomes a data-artifact part keyed by message and artifact", async () => {
    const out = await chunks([
      { type: "start", messageId: "m1", botId: "bot-a", botName: "A" },
      { type: "artifact", messageId: "m1", botId: "bot-a", id: "a1", title: "Report", at: 1 },
      { type: "done" },
    ]);
    expect(out.find((c) => c.type === "data-artifact")).toEqual({
      type: "data-artifact",
      id: "m1:a1",
      data: { messageId: "m1", id: "a1", title: "Report", at: 1 },
    });
  });

  test("a plan becomes one data-plan part per message, so each update replaces the last", async () => {
    const steps = [{ id: "1", title: "Read", status: "active" as const }];
    const out = await chunks([
      { type: "start", messageId: "m1", botId: "bot-a", botName: "A" },
      { type: "plan", messageId: "m1", botId: "bot-a", steps },
      { type: "done" },
    ]);
    expect(out.find((c) => c.type === "data-plan")).toEqual({
      type: "data-plan",
      id: "m1:plan",
      data: { messageId: "m1", steps },
    });
  });

  test("taken notes become a transient data-steer signal that is not kept in the message", async () => {
    const out = await chunks([
      { type: "start", messageId: "m1", botId: "bot-a", botName: "A" },
      { type: "steer", messageId: "m1", botId: "bot-a", noteIds: ["n1"] },
      { type: "done" },
    ]);
    expect(out.find((c) => c.type === "data-steer")).toEqual({
      type: "data-steer",
      data: { messageId: "m1", noteIds: ["n1"] },
      transient: true,
    });
  });

  test("a thrown error becomes an error chunk", async () => {
    const out = await chunks(async function* () {
      yield { type: "start", messageId: "m1", botId: "b", botName: "B" };
      throw new Error("boom");
    });
    expect(out.map((c) => c.type)).toEqual(["start", "data-speaker", "text-start", "error"]);
    expect(out.at(-1)?.errorText).toBeString();
  });
});

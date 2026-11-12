import { describe, expect, test } from "bun:test";

import { seenInChat, seenInRoom, type SeenTurn } from "./seen";

const row = (id: string, seq: number, role: string, parentMessageId: string | null = null) => ({
  id,
  seq,
  role,
  parentMessageId,
});
const turn = (
  triggerMessageId: string,
  botId: string,
  status: string,
  reasonCode: string | null = null,
): SeenTurn => ({ triggerMessageId, botId, status, reasonCode });

describe("seenInRoom", () => {
  const rows = [row("u1", 1, "user"), row("a1", 2, "assistant"), row("u2", 3, "user")];
  test("a turn that started has read the post", () => {
    const seen = seenInRoom(rows, [turn("u1", "dev", "running"), turn("u1", "qa", "done")]);
    expect(seen.get("u1")?.sort()).toEqual(["dev", "qa"]);
  });
  test("a failed or interrupted turn read it too, a silent one as well", () => {
    const seen = seenInRoom(rows, [
      turn("u1", "a", "failed"),
      turn("u1", "b", "interrupted"),
      turn("u1", "c", "done", "silent"),
    ]);
    expect(seen.get("u1")?.sort()).toEqual(["a", "b", "c"]);
  });
  test("a turn skipped because a later turn of the bot covered it counts", () => {
    expect(seenInRoom(rows, [turn("u1", "dev", "skipped", "merged")]).get("u1")).toEqual(["dev"]);
  });
  test("queued, awaiting approval, cancelled and other skipped turns have not read it", () => {
    const seen = seenInRoom(rows, [
      turn("u1", "a", "queued"),
      turn("u1", "b", "awaiting_approval"),
      turn("u1", "c", "cancelled"),
      turn("u1", "d", "skipped", "bot_unavailable"),
    ]);
    expect(seen.get("u1")).toEqual([]);
  });
  test("each bot is listed once, and only a person's posts have an entry", () => {
    const seen = seenInRoom(rows, [turn("u1", "dev", "done"), turn("u1", "dev", "running")]);
    expect(seen.get("u1")).toEqual(["dev"]);
    expect(seen.has("a1")).toBe(false);
    expect(seen.get("u2")).toEqual([]);
  });
});

describe("seenInChat", () => {
  test("a message with a later reply on the main line is read, the last one is not", () => {
    const rows = [row("u1", 1, "user"), row("a1", 2, "assistant"), row("u2", 3, "user")];
    const seen = seenInChat(rows, "bot", new Map());
    expect(seen.get("u1")).toEqual(["bot"]);
    expect(seen.get("u2")).toEqual([]);
  });
  test("a reply that is still streaming counts: the bot has started", () => {
    const rows = [row("u1", 1, "user"), row("a1", 2, "assistant")];
    expect(seenInChat(rows, "bot", new Map()).get("u1")).toEqual(["bot"]);
  });
  test("a message sent in a thread is read by a reply in that thread, not by one on the main line", () => {
    const rows = [
      row("root", 1, "assistant"),
      row("t1", 2, "user", "root"),
      row("main", 3, "assistant"),
    ];
    expect(seenInChat(rows, "bot", new Map()).get("t1")).toEqual([]);
    const answered = [...rows, row("t2", 4, "assistant", "root")];
    expect(seenInChat(answered, "bot", new Map()).get("t1")).toEqual(["bot"]);
  });
  test("a reply in the thread a message opened reads that message", () => {
    const rows = [row("u1", 1, "user"), row("a1", 2, "assistant", "u1")];
    expect(seenInChat(rows, "bot", new Map()).get("u1")).toEqual(["bot"]);
  });
  test("a queued message decides by its own state, whatever the bot answered later", () => {
    const rows = [
      row("u1", 1, "user"),
      row("u2", 2, "user"),
      row("u3", 3, "user"),
      row("u4", 4, "user"),
      row("a", 5, "assistant"),
    ];
    const queue = new Map([
      ["u1", "pending"],
      ["u2", "held"],
      ["u3", "failed"],
      ["u4", "running"],
    ]);
    const seen = seenInChat(rows, "bot", queue);
    expect([seen.get("u1"), seen.get("u2"), seen.get("u3"), seen.get("u4")]).toEqual([
      [],
      [],
      [],
      ["bot"],
    ]);
    expect(seenInChat(rows, "bot", new Map([["u1", "merged"]])).get("u1")).toEqual(["bot"]);
  });
  test("without a bot nobody has read anything", () => {
    const rows = [row("u1", 1, "user"), row("a1", 2, "assistant")];
    expect(seenInChat(rows, null, new Map()).get("u1")).toEqual([]);
  });
});

import { afterEach, describe, expect, test } from "bun:test";

import { keysFor } from "./live-events";
import { queryClient } from "./query-client";
import { pollEvery, setLive } from "./query-policy";

describe("keysFor", () => {
  test("a chat topic refreshes the messages, loops and turn of that chat", () => {
    expect(keysFor("conversation:abc")).toEqual([
      { queryKey: ["conversations", "abc"], exact: false },
    ]);
  });
  test("a playground topic refreshes what is on screen of the playground: the list, the files, the runs and the run", () => {
    expect(keysFor("playground:p1")).toEqual([{ queryKey: ["playground"] }]);
  });
  test("a workflows topic refreshes the runs on screen", () => {
    expect(keysFor("workflows")).toEqual([{ queryKey: ["workflows"] }]);
  });
  test("a bot-quality topic refreshes the saved tests, the numbers and the history of bots on screen", () => {
    expect(keysFor("bot-quality:b1")).toEqual([{ queryKey: ["bot-quality"] }]);
  });
  test("a tasks topic refreshes the board, an open task page and the projects together", () => {
    expect(keysFor("tasks")).toEqual([{ queryKey: ["tasks"] }, { queryKey: ["projects"] }]);
    expect(keysFor("projects")).toEqual([{ queryKey: ["projects"] }]);
  });
  test("an apps topic refreshes everything on screen about apps: the list, an app, its calls and the tools", () => {
    expect(keysFor("apps")).toEqual([{ queryKey: ["apps"] }]);
  });
  test("a room topic refreshes the room, its proposals and, once the room is cached, its transcript", () => {
    expect(keysFor("discussion:r1")).toEqual([
      { queryKey: ["discussions", "r1"] },
      { queryKey: ["proposals"] },
    ]);
    queryClient.setQueryData(["discussions", "r1"], { discussion: { conversationId: "c1" } });
    expect(keysFor("discussion:r1")).toEqual([
      { queryKey: ["discussions", "r1"] },
      { queryKey: ["conversations", "c1", "messages"], exact: true },
      { queryKey: ["proposals"] },
    ]);
    queryClient.clear();
  });
  test("a change in the decision cards refreshes the badge and the Inbox queue", () => {
    expect(keysFor("attention")).toEqual([
      { queryKey: ["attention"], exact: true },
      { queryKey: ["catch-up"] },
      { queryKey: ["attention-updates"] },
    ]);
  });
  test("a change in the approvals refreshes the chat footer, the badge and the Inbox queue", () => {
    expect(keysFor("proposals")).toEqual([
      { queryKey: ["proposals"] },
      { queryKey: ["attention"], exact: true },
      { queryKey: ["catch-up"] },
    ]);
  });
  test("list topics refresh only the list entries", () => {
    expect(keysFor("conversations")).toEqual([
      { queryKey: ["conversations", "list"], exact: true },
    ]);
    expect(keysFor("rooms")).toEqual([
      { queryKey: ["discussions", "list"], exact: true },
      { queryKey: ["discussions", "running"], exact: true },
    ]);
    expect(keysFor("bot-status")).toEqual([{ queryKey: ["bots", "status"], exact: true }]);
  });
  test("a saved step of a running turn refreshes only the turn state, not the messages the stream is writing", () => {
    expect(keysFor("turn:abc")).toEqual([
      { queryKey: ["conversations", "abc", "turn"], exact: true },
    ]);
  });
  test("a plugin's connection change refreshes the plugin queries and the WhatsApp pairing dialog", () => {
    expect(keysFor("plugin-status:whatsapp")).toEqual([
      { queryKey: ["plugins"] },
      { queryKey: ["whatsapp-pairing"] },
    ]);
  });
  test("resync refreshes every query", () => {
    expect(keysFor("resync")).toEqual([{ queryKey: [] }]);
  });
  test("an unknown topic refreshes nothing", () => {
    expect(keysFor("something-else")).toEqual([]);
  });
});

describe("pollEvery", () => {
  afterEach(() => setLive(false));
  test("without the live channel it uses the fast interval while active, else the slow one", () => {
    expect(pollEvery(2000, 10_000, true)).toBe(2000);
    expect(pollEvery(2000, 10_000, false)).toBe(10_000);
    expect(pollEvery(3000, false, false)).toBe(false);
  });
  test("with the live channel it only keeps a safety net: 15 s active, 60 s idle", () => {
    setLive(true);
    expect(pollEvery(2000, 10_000, true)).toBe(15_000);
    expect(pollEvery(2000, 10_000, false)).toBe(60_000);
    expect(pollEvery(3000, false, false)).toBe(false);
  });
});

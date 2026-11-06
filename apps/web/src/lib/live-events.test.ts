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

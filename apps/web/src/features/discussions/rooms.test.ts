import { describe, expect, test } from "bun:test";
import type { DiscussionListItem } from "./discussions-api";
import { groupRooms, orderRooms, roomLabel, roomSignal, roomStatus } from "./rooms";

const item = (v: Partial<DiscussionListItem> & { id: string; title: string }): DiscussionListItem =>
  ({
    conversationId: "c",
    goal: "",
    context: "",
    contextVersion: 1,
    status: "open",
    kind: "room",
    tainted: false,
    turnsUsed: 0,
    summary: "",
    version: 1,
    createdByBotId: null,
    teamId: null,
    originConversationId: null,
    originInbound: null,
    createdAt: "2026-10-30T10:00:00Z",
    updatedAt: "2026-10-30T10:00:00Z",
    members: [],
    queued: 0,
    running: false,
    awaitingApproval: false,
    ...v,
  }) as DiscussionListItem;

describe("groupRooms", () => {
  test("rooms sort by name so the sidebar does not jump while bots work", () => {
    const { rooms } = groupRooms([
      item({ id: "1", title: "release" }),
      item({ id: "2", title: "Design review" }),
      item({ id: "3", title: "devs" }),
    ]);
    expect(rooms.map((r) => r.title)).toEqual(["Design review", "devs", "release"]);
  });

  test("help and permission rooms are bot issues, not rooms", () => {
    const { rooms, issues } = groupRooms([
      item({ id: "1", title: "devs", teamId: "t" }),
      item({ id: "2", title: "Help: Scout: Reddit blocks fetches", kind: "help" }),
      item({ id: "3", title: "Permissions", kind: "permissions" }),
    ]);
    expect(rooms.map((r) => r.id)).toEqual(["1"]);
    expect(issues.map((r) => r.id)).toEqual(["2", "3"]);
  });

  test("closed rooms leave the sidebar; paused and stalled stay", () => {
    const { rooms, issues } = groupRooms([
      item({ id: "1", title: "a", status: "resolved" }),
      item({ id: "2", title: "b", status: "cancelled" }),
      item({ id: "3", title: "c", status: "paused" }),
      item({ id: "4", title: "d", status: "stalled" }),
      item({ id: "5", title: "Help: x", kind: "help", status: "resolved" }),
    ]);
    expect(rooms.map((r) => r.id)).toEqual(["3", "4"]);
    expect(issues).toEqual([]);
  });

  test("bot issues list the newest first", () => {
    const { issues } = groupRooms([
      item({ id: "1", title: "Help: a", kind: "help", updatedAt: "2026-10-30T09:00:00Z" }),
      item({ id: "2", title: "Help: b", kind: "help", updatedAt: "2026-10-30T11:00:00Z" }),
    ]);
    expect(issues.map((r) => r.id)).toEqual(["2", "1"]);
  });
});

describe("roomSignal", () => {
  test("a bot waiting for the user outranks a bot working", () => {
    expect(roomSignal(item({ id: "1", title: "a", awaitingApproval: true, running: true }))).toBe(
      "needs-you",
    );
  });

  test("a stalled room needs the user", () => {
    expect(roomSignal(item({ id: "1", title: "a", status: "stalled" }))).toBe("needs-you");
  });

  test("a running turn means a bot is working", () => {
    expect(roomSignal(item({ id: "1", title: "a", running: true }))).toBe("working");
    expect(roomSignal(item({ id: "1", title: "a", running: true, queued: 2 }))).toBe("working");
  });

  test("queued turns alone mean the room waits for a turn, not that a bot works", () => {
    expect(roomSignal(item({ id: "1", title: "a", queued: 2 }))).toBe("queued");
  });

  test("a paused room says so; a quiet room has no signal", () => {
    expect(roomSignal(item({ id: "1", title: "a", status: "paused" }))).toBe("paused");
    expect(roomSignal(item({ id: "1", title: "a" }))).toBe("idle");
  });
});

describe("roomStatus", () => {
  test("says what the user should know, in plain words", () => {
    expect(roomStatus(item({ id: "1", title: "a", awaitingApproval: true }))).toBe(
      "Waiting for you",
    );
    expect(roomStatus(item({ id: "1", title: "a", running: true }))).toBe("Bot working…");
    expect(roomStatus(item({ id: "1", title: "a", status: "stalled" }))).toBe("Needs you");
    expect(roomStatus(item({ id: "1", title: "a", status: "paused" }))).toBe("Paused");
    expect(roomStatus(item({ id: "1", title: "a", status: "resolved" }))).toBe("Resolved");
    expect(roomStatus(item({ id: "1", title: "a", status: "cancelled" }))).toBe("Cancelled");
  });

  test("queued turns with nothing running say the room waits", () => {
    expect(roomStatus(item({ id: "1", title: "a", queued: 1 }))).toBe("Waiting for a turn");
  });

  test("a quiet open room has no status", () => {
    expect(roomStatus(item({ id: "1", title: "a" }))).toBe("");
  });
});

describe("roomLabel", () => {
  test("a help room drops the prefix its kind already says", () => {
    expect(roomLabel({ kind: "help", title: "Help: Scout: Reddit blocks fetches" })).toBe(
      "Scout: Reddit blocks fetches",
    );
  });

  test("any other title is shown as it is", () => {
    expect(roomLabel({ kind: "room", title: "Help: a user's own title" })).toBe(
      "Help: a user's own title",
    );
    expect(roomLabel({ kind: "permissions", title: "Permissions" })).toBe("Permissions");
  });
});

describe("orderRooms", () => {
  const rooms = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  test("placed rooms come first in the saved order, the rest keep their place", () => {
    expect(orderRooms(rooms, ["c", "a"]).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });
  test("an id that is no longer a room is ignored, and an empty order changes nothing", () => {
    expect(orderRooms(rooms, ["gone", "d"]).map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
    expect(orderRooms(rooms, []).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
});

import { expect, test } from "bun:test";

import { pickSidebarBots } from "./sidebar-bot-list";

const bot = (id: string, kind = "specialist") => ({ id, kind, name: `Bot ${id}` });
const chief = bot("chief", "chief");
const ids = (r: { shown: { id: string }[] }) => r.shown.map((b) => b.id);

test("the chief is first, then the rest by latest chat", () => {
  const bots = [bot("a"), bot("b"), chief, bot("c")];
  const chats = [
    { botId: "a", updatedAt: "2026-01-01T00:00:00Z" },
    { botId: "c", updatedAt: "2026-03-01T00:00:00Z" },
    { botId: "b", updatedAt: "2026-02-01T00:00:00Z" },
  ];
  expect(ids(pickSidebarBots(bots, chats, { order: [] }))).toEqual(["chief", "c", "b", "a"]);
});

test("bots the person placed come before the ones sorted by activity", () => {
  const bots = [bot("a"), bot("b"), bot("c")];
  const chats = [{ botId: "a", updatedAt: "2026-05-01T00:00:00Z" }];
  expect(ids(pickSidebarBots(bots, chats, { order: ["c", "b"] }))).toEqual(["c", "b", "a"]);
});

test("a bot with no chat goes last and keeps the server order", () => {
  const bots = [bot("x"), bot("y"), bot("z")];
  const chats = [{ botId: "z", updatedAt: "2026-05-01T00:00:00Z" }];
  expect(ids(pickSidebarBots(bots, chats, { order: [] }))).toEqual(["z", "x", "y"]);
});

test("the list is capped and reports the total", () => {
  const bots = Array.from({ length: 12 }, (_, i) => bot(`b${i}`));
  const r = pickSidebarBots(bots, [], { order: [], limit: 7 });
  expect(r.shown).toHaveLength(7);
  expect(r.total).toBe(12);
});

test("the open bot shows even when it falls outside the cap", () => {
  const bots = Array.from({ length: 12 }, (_, i) => bot(`b${i}`));
  const r = pickSidebarBots(bots, [], { order: [], limit: 7, currentId: "b11" });
  expect(r.shown).toHaveLength(7);
  expect(ids(r)).toContain("b11");
  expect(ids(r)[0]).toBe("b0");
});

test("a search ignores the cap and lists every name match", () => {
  const bots = Array.from({ length: 12 }, (_, i) => bot(`b${i}`));
  const r = pickSidebarBots(bots, [], { order: [], limit: 3, query: " BOT b1" });
  expect(ids(r)).toEqual(["b1", "b10", "b11"]);
});

test("pinned bots replace the automatic list: the chief, then the pins in their order, without the cap", () => {
  const bots = [chief, ...["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => bot(id))];
  const chats = [{ botId: "i", updatedAt: "2026-03-01T00:00:00Z" }];
  const pinned = ["h", "b"];
  expect(ids(pickSidebarBots(bots, chats, { order: [], pinned }))).toEqual(["chief", "h", "b"]);
  // The open bot is not forced in: the person can take out the bot whose chat is open.
  expect(ids(pickSidebarBots(bots, chats, { order: [], pinned, currentId: "e" }))).toEqual([
    "chief",
    "h",
    "b",
  ]);
  // Many pins are all shown: the cap is for the automatic list only.
  const many = bots.slice(1).map((b) => b.id);
  expect(pickSidebarBots(bots, chats, { order: [], pinned: many }).shown).toHaveLength(10);
});

test("a search still finds every bot, pinned or not", () => {
  const bots = [chief, bot("a"), bot("b"), bot("c")];
  const found = pickSidebarBots(bots, [], { order: [], pinned: ["a"], query: "bot b" });
  expect(ids(found)).toEqual(["b"]);
});

test("pins to bots that are gone leave the automatic list as it was", () => {
  const bots = [chief, bot("a"), bot("b")];
  expect(ids(pickSidebarBots(bots, [], { order: [], pinned: ["gone"] }))).toEqual([
    "chief",
    "a",
    "b",
  ]);
});

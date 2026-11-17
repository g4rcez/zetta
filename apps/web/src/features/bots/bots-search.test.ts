import { expect, test } from "bun:test";

import { filterBots, parseBotsSearch } from "./bots-search";

const bots = [
  { name: "Dev Bot", role: "Writes code", description: "Fixes bugs in the API" },
  { name: "Ana", description: "Answers support mail" },
  { name: "Chief", role: "Runs the team", description: "" },
];

test("the search keeps the words and drops what is not text", () => {
  expect(parseBotsSearch({ q: "  dev  " })).toEqual({ q: "dev" });
  expect(parseBotsSearch({ q: "   " })).toEqual({});
  expect(parseBotsSearch({ q: 5 })).toEqual({});
  expect(parseBotsSearch({})).toEqual({});
  expect(parseBotsSearch({ q: "x".repeat(300) }).q).toHaveLength(100);
});

test("every word must match the name, role or description", () => {
  expect(filterBots(bots, undefined)).toHaveLength(3);
  expect(filterBots(bots, "").map((b) => b.name)).toEqual(["Dev Bot", "Ana", "Chief"]);
  expect(filterBots(bots, "bugs api").map((b) => b.name)).toEqual(["Dev Bot"]);
  expect(filterBots(bots, "SUPPORT").map((b) => b.name)).toEqual(["Ana"]);
  expect(filterBots(bots, "runs team").map((b) => b.name)).toEqual(["Chief"]);
  expect(filterBots(bots, "bugs mail")).toEqual([]);
});

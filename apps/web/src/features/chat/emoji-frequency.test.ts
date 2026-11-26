import { describe, expect, test } from "bun:test";
import data from "emojibase-data/en/compact.json";

import { COMMON_EMOJI, countUse, frequentEmoji, FREQUENT_MAX, parseUses } from "./emoji-frequency";

describe("frequently used emojis", () => {
  test("a person who never picked one gets the common ones, all of which the picker has", () => {
    expect(frequentEmoji([])).toEqual(COMMON_EMOJI);
    expect(COMMON_EMOJI).toHaveLength(FREQUENT_MAX);
    const known = new Set((data as { unicode: string }[]).map((e) => e.unicode));
    expect(COMMON_EMOJI.filter((e) => !known.has(e))).toEqual([]);
  });
  test("the most picked comes first, and the later pick wins a tie", () => {
    let uses = countUse([], "🐢");
    uses = countUse(uses, "🐙");
    uses = countUse(uses, "🌵");
    uses = countUse(uses, "🐙");
    expect(frequentEmoji(uses).slice(0, 3)).toEqual(["🐙", "🌵", "🐢"]);
  });
  test("the older recent list comes before the common ones, with nothing twice", () => {
    const list = frequentEmoji(countUse([], "👍"), ["🌵", "👍"]);
    expect(list.slice(0, 3)).toEqual(["👍", "🌵", "❤️"]);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toHaveLength(FREQUENT_MAX);
  });
  test("bad storage is ignored", () => {
    expect(parseUses("x")).toEqual([]);
    expect(parseUses([["🐢", 2], ["🐙"], 4, ["🌵", "3"]])).toEqual([["🐢", 2]]);
  });
});

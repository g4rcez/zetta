import { expect, test } from "bun:test";
import { isReactionEmoji } from "./service";

test("accepts any single emoji, rejects text", () => {
  for (const ok of ["👍", "❤️", "👍🏽", "🇧🇷", "👨‍👩‍👧", "1️⃣", "🫠"])
    expect(isReactionEmoji(ok)).toBe(true);
  for (const bad of ["", "a", "ab", "👍👎", "👍 x", "<b>", "1"])
    expect(isReactionEmoji(bad)).toBe(false);
});

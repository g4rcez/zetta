import { expect, test } from "bun:test";

import { toggleReaction } from "./reactions";

test("adds a first reaction", () => expect(toggleReaction(undefined, "👍")).toEqual([{ emoji: "👍", count: 1, mine: true }]));
test("removes my only reaction", () => expect(toggleReaction([{ emoji: "👍", count: 1, mine: true }], "👍")).toEqual([]));
test("joins an existing count", () => expect(toggleReaction([{ emoji: "👍", count: 2, mine: false }], "👍")).toEqual([{ emoji: "👍", count: 3, mine: true }]));
test("leaves others when removing mine", () => expect(toggleReaction([{ emoji: "👍", count: 2, mine: true }, { emoji: "🎉", count: 1, mine: false }], "👍")).toEqual([{ emoji: "👍", count: 1, mine: false }, { emoji: "🎉", count: 1, mine: false }]));

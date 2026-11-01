import { describe, expect, it } from "bun:test";

import { splitBotTags, type TagBot } from "./bot-tags";

const bots: TagBot[] = [
  { id: "1", name: "DaVinci" },
  { id: "2", name: "Boss" },
  { id: "3", name: "Code Reviewer" },
];
const text = (p: ReturnType<typeof splitBotTags>) =>
  p?.map((x) => ("bot" in x ? `[${x.text}]` : x.text)).join("");

describe("splitBotTags", () => {
  it("tags a plain bot name", () => {
    expect(text(splitBotTags("DaVinci (id 1) is ready", bots))).toBe("[DaVinci] (id 1) is ready");
  });
  it("tags @Name in any case and the spaceless key", () => {
    expect(text(splitBotTags("ask @davinci and @CodeReviewer", bots))).toBe(
      "ask [@davinci] and [@CodeReviewer]",
    );
  });
  it("tags a name with spaces", () => {
    expect(text(splitBotTags("Code Reviewer found it", bots))).toBe("[Code Reviewer] found it");
  });
  it("keeps a plain word of another case", () => {
    expect(splitBotTags("the boss said no", bots)).toBeUndefined();
  });
  it("does not tag inside a longer word", () => {
    expect(splitBotTags("Bossy DaVincis", bots)).toBeUndefined();
  });
});

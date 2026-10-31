import { describe, expect, test } from "bun:test";

import type { Bot } from "./chat-client";
import { mentionedBots, withMention, withoutMention } from "./mention";

const bot = (id: string, name: string) => ({ id, name }) as Bot;
const dev = bot("1", "Dev");
const vinci = bot("2", "Da Vinci");
const bots = [dev, vinci];

describe("mentionedBots", () => {
  test("finds tagged bots, ignoring case and spaces in the name", () => {
    expect(mentionedBots("@dev fix it, then @davinci check", bots)).toEqual([dev, vinci]);
  });
  test("ignores unknown tags and plain words", () => {
    expect(mentionedBots("@ghost look; Dev is not a tag", bots)).toEqual([]);
  });
  test("lists a bot once when it is tagged twice", () => {
    expect(mentionedBots("@Dev and again @Dev", bots)).toEqual([dev]);
  });
});

describe("withMention", () => {
  test("adds a tag after the text", () => {
    expect(withMention("fix login", dev)).toBe("fix login @Dev ");
  });
  test("keeps the text when the bot is already tagged", () => {
    expect(withMention("@dev fix login", dev)).toBe("@dev fix login");
  });
});

describe("withoutMention", () => {
  test("removes every tag of the bot and keeps the others", () => {
    expect(withoutMention("@Dev fix it @Dev @DaVinci check", dev)).toBe("fix it @DaVinci check");
  });
});

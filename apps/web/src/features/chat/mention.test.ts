import { describe, expect, test } from "bun:test";

import type { Bot } from "./chat-client";
import { mentionedBots, withMention, withoutMention } from "./mention";

const bot = (id: string, name: string) => ({ id, name }) as Bot;
const DEV = "01929c3e-0000-7000-8000-00000000000a";
const VINCI = "01929c3e-0000-7000-8000-00000000000b";
const dev = bot(DEV, "Dev");
const vinci = bot(VINCI, "Da Vinci");
const bots = [dev, vinci];

describe("mentionedBots", () => {
  test("finds a bot by the id in its token, even when the label is an old name", () => {
    expect(
      mentionedBots(`[@Old name](bot:${DEV}) fix it, then [@Da Vinci](bot:${VINCI}) check`, bots),
    ).toEqual([dev, vinci]);
  });
  test("finds a hand-typed @Name, ignoring case and spaces in the name", () => {
    expect(mentionedBots("@dev fix it, then @davinci check", bots)).toEqual([dev, vinci]);
  });
  test("ignores unknown tags, tokens of other bots and plain words", () => {
    expect(
      mentionedBots(
        "@ghost look; Dev is not a tag; [@Ghost](bot:01929c3e-0000-7000-8000-0000000000ff)",
        bots,
      ),
    ).toEqual([]);
  });
  test("lists a bot once when it is tagged twice", () => {
    expect(mentionedBots(`[@Dev](bot:${DEV}) and again @Dev`, bots)).toEqual([dev]);
  });
});

describe("withMention", () => {
  test("adds the token after the text", () => {
    expect(withMention("fix login", dev)).toBe(`fix login [@Dev](bot:${DEV}) `);
  });
  test("keeps the text when the bot is already tagged, by token or by hand", () => {
    expect(withMention(`[@Dev](bot:${DEV}) fix login`, dev)).toBe(`[@Dev](bot:${DEV}) fix login`);
    expect(withMention("@dev fix login", dev)).toBe("@dev fix login");
  });
});

describe("withoutMention", () => {
  test("removes every tag of the bot, token or hand-typed, and keeps the others", () => {
    expect(
      withoutMention(`[@Dev](bot:${DEV}) fix it @Dev [@Da Vinci](bot:${VINCI}) check`, dev),
    ).toBe(`fix it [@Da Vinci](bot:${VINCI}) check`);
  });
  test("removes a token whose label is an old name", () => {
    expect(withoutMention(`[@Old](bot:${DEV}) fix it`, dev)).toBe("fix it");
  });
});

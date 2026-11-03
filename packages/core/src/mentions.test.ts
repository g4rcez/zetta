import { describe, expect, it } from "bun:test";
import {
  isReservedBotName,
  legacyMentions,
  mentionIds,
  mentionKey,
  mentionsAsText,
  mentionToken,
  mentionsUser,
  normalizeMentions,
  parseMentions,
  refreshMentions,
} from "./mentions";

const DEV = "01929c3e-0000-7000-8000-00000000000a";
const VINCI = "01929c3e-0000-7000-8000-00000000000b";
const CORE = "01929c3e-0000-7000-8000-00000000000c";

describe("isReservedBotName", () => {
  it("blocks the reserved names in any case or spacing", () => {
    expect(isReservedBotName("user")).toBe(true);
    expect(isReservedBotName("User")).toBe(true);
    expect(isReservedBotName("ALL")).toBe(true);
    expect(isReservedBotName("He re")).toBe(true);
    expect(isReservedBotName("  channel ")).toBe(true);
  });
  it("allows other names", () => {
    expect(isReservedBotName("Dredd")).toBe(false);
    expect(isReservedBotName("username")).toBe(false);
    expect(isReservedBotName("all-rounder")).toBe(false);
  });
});

describe("mentionsUser", () => {
  it("finds @user as a whole token", () => {
    expect(mentionsUser("@user, one question on D3.")).toBe(true);
    expect(mentionsUser("Me next.\n\n@User: please check")).toBe(true);
    expect(mentionsUser("ask (@user) now")).toBe(true);
  });
  it("ignores look-alikes", () => {
    expect(mentionsUser("@username is a bot")).toBe(false);
    expect(mentionsUser("write to a@user.com")).toBe(false);
    expect(mentionsUser("@Dredd and @DaVinci")).toBe(false);
    expect(mentionsUser("no mention")).toBe(false);
  });
});

describe("mentionKey", () => {
  it("removes spaces and lowercases", () => {
    expect(mentionKey("Da Vinci")).toBe("davinci");
  });
});

describe("mentionToken", () => {
  it("writes a Markdown link per kind", () => {
    expect(mentionToken("bot", DEV, "Dev")).toBe(`[@Dev](bot:${DEV})`);
    expect(mentionToken("team", CORE, "Core")).toBe(`[#Core](team:${CORE})`);
    expect(mentionToken("room", CORE, "Launch day")).toBe(`[#Launch day](room:${CORE})`);
  });
  it("escapes brackets and backslashes in the name", () => {
    expect(mentionToken("bot", DEV, "A]b[c\\d")).toBe(`[@A\\]b\\[c\\\\d](bot:${DEV})`);
  });
  it("puts a multi-line name on one line", () => {
    expect(mentionToken("bot", DEV, "Da\n Vinci ")).toBe(`[@Da Vinci](bot:${DEV})`);
  });
});

describe("parseMentions", () => {
  it("reads kind, id and the unescaped label", () => {
    const text = `Hi ${mentionToken("bot", DEV, "A]b")} and ${mentionToken("team", CORE, "Core")}.`;
    expect(parseMentions(text).map((m) => [m.kind, m.id, m.label])).toEqual([
      ["bot", DEV, "A]b"],
      ["team", CORE, "Core"],
    ]);
  });
  it("ignores a link whose sigil does not match its kind", () => {
    expect(parseMentions(`[#Dev](bot:${DEV}) [@Core](team:${CORE})`)).toEqual([]);
  });
  it("ignores ordinary links and a malformed id", () => {
    expect(parseMentions("[@Dev](https://example.invalid) [@Dev](bot:123)")).toEqual([]);
  });
});

describe("mentionIds", () => {
  it("lists each id of a kind once, in order", () => {
    const text = `${mentionToken("bot", VINCI, "V")} ${mentionToken("bot", DEV, "D")} ${mentionToken("bot", VINCI, "V")} ${mentionToken("team", CORE, "C")}`;
    expect(mentionIds(text, "bot")).toEqual([VINCI, DEV]);
    expect(mentionIds(text, "team")).toEqual([CORE]);
    expect(mentionIds(text, "room")).toEqual([]);
  });
  it("matches an upper-case id as lower case", () => {
    expect(mentionIds(`[@Dev](bot:${DEV.toUpperCase()})`, "bot")).toEqual([DEV]);
  });
});

describe("mentionsAsText", () => {
  it("shows each token as its sigil and label", () => {
    expect(mentionsAsText(`Ask [@Dev](bot:${DEV}) and [#Core](team:${CORE}) now`)).toBe(
      "Ask @Dev and #Core now",
    );
  });
  it("shows an escaped label as written", () => {
    expect(mentionsAsText(mentionToken("bot", DEV, "A]b"))).toBe("@A]b");
  });
});

describe("refreshMentions", () => {
  it("writes the current name of a known id", () => {
    const text = `${mentionToken("bot", DEV, "Old")} go`;
    expect(refreshMentions(text, new Map([[DEV, "New"]]))).toBe(`[@New](bot:${DEV}) go`);
  });
  it("keeps the label of an unknown id", () => {
    const text = `${mentionToken("bot", DEV, "Old")} go`;
    expect(refreshMentions(text, new Map())).toBe(text);
  });
});

describe("legacyMentions", () => {
  it("lists @word and #word with their position, lower case", () => {
    expect(legacyMentions("Hi @Dev and #Core")).toEqual([
      { sigil: "@", key: "dev", index: 3, length: 4 },
      { sigil: "#", key: "core", index: 12, length: 5 },
    ]);
  });
  it("skips tokens, code, URLs and emails", () => {
    expect(
      legacyMentions(`[@Dev](bot:${DEV}) \`@Dev\` https://example.invalid/#core a@dev.com`),
    ).toEqual([]);
  });
});

describe("normalizeMentions", () => {
  const resolve = (sigil: "@" | "#", key: string) => {
    if (sigil === "@" && key === "dev") return { kind: "bot" as const, id: DEV, name: "Dev" };
    if (sigil === "@" && key === "davinci")
      return { kind: "bot" as const, id: VINCI, name: "Da Vinci" };
    if (sigil === "#" && key === "core") return { kind: "team" as const, id: CORE, name: "Core" };
    return undefined;
  };
  it("turns @Name and #Name into tokens, ignoring case", () => {
    expect(normalizeMentions("@DEV fix it, then @davinci check #Core", resolve)).toBe(
      `[@Dev](bot:${DEV}) fix it, then [@Da Vinci](bot:${VINCI}) check [#Core](team:${CORE})`,
    );
  });
  it("leaves unknown names, @user and emails alone", () => {
    expect(normalizeMentions("@ghost @user a@dev.com", resolve)).toBe("@ghost @user a@dev.com");
  });
  it("leaves a longer word alone", () => {
    expect(normalizeMentions("@devops", resolve)).toBe("@devops");
  });
  it("skips fenced code, inline code, links and URLs", () => {
    const text =
      "```\n@Dev\n```\n`@Dev` [@Dev](https://example.invalid) https://example.invalid/#core";
    expect(normalizeMentions(text, resolve)).toBe(text);
  });
  it("keeps an existing token and is idempotent", () => {
    const once = normalizeMentions("@Dev and [@Old](bot:" + DEV + ")", resolve);
    expect(once).toBe(`[@Dev](bot:${DEV}) and [@Old](bot:${DEV})`);
    expect(normalizeMentions(once, resolve)).toBe(once);
  });
  it("handles a mention at the start, end and before punctuation", () => {
    expect(normalizeMentions("@Dev, @Dev. (@Dev)", resolve)).toBe(
      `[@Dev](bot:${DEV}), [@Dev](bot:${DEV}). ([@Dev](bot:${DEV}))`,
    );
  });
});

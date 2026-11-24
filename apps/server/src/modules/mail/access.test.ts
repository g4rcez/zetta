import { describe, expect, test } from "bun:test";
import type { MailboxState } from "@zetta/db/schema/mail";
import type { PluginTurn } from "../integrations/plugins/turn";
import {
  mailAccess,
  MAIL_TURNS,
  personMailAccess,
  type MailAccess,
  type MailAccessInput,
} from "./access";

const ME = "user-me";
const OTHER_PERSON = "user-other";
const CHIEF = { id: "bot-chief", kind: "chief" as const, ownerUserId: ME };
const OWNER_BOT = { id: "bot-owner", kind: "specialist" as const, ownerUserId: ME };
const SIBLING = { id: "bot-sibling", kind: "specialist" as const, ownerUserId: ME };
const STRANGER_BOT = { id: "bot-stranger", kind: "specialist" as const, ownerUserId: OTHER_PERSON };
const STRANGER_CHIEF = { id: "bot-chief-2", kind: "chief" as const, ownerUserId: OTHER_PERSON };

const box = (
  over: Partial<{ ownerUserId: string; botId: string | null; state: MailboxState }> = {},
) => ({
  ownerUserId: ME,
  botId: OWNER_BOT.id as string | null,
  state: "active" as MailboxState,
  ...over,
});

type Row = [string, MailAccessInput, MailAccess];
const at = (
  bot: MailAccessInput["bot"],
  mailbox: ReturnType<typeof box>,
  turn: PluginTurn | null = "chat",
  actorUserId = ME,
) => ({ actorUserId, bot, mailbox, turn: turn ?? undefined });

describe("who may read a mailbox through a bot", () => {
  const who: Row[] = [
    ["the owner bot reads its own mailbox", at(OWNER_BOT, box()), "read"],
    ["the Chief reads an unowned mailbox", at(CHIEF, box({ botId: null })), "read"],
    ["the Chief gets nothing on a mailbox another bot owns", at(CHIEF, box()), "denied"],
    ["another bot of the same person gets nothing", at(SIBLING, box()), "denied"],
    ["another bot gets nothing on an unowned mailbox", at(SIBLING, box({ botId: null })), "denied"],
    [
      "a bot of another person gets nothing on a mailbox that names its id",
      at(STRANGER_BOT, box()),
      "denied",
    ],
    [
      "another person's bot acting for the owner gets nothing",
      at(STRANGER_BOT, box({ botId: STRANGER_BOT.id })),
      "denied",
    ],
    [
      "another person's Chief gets nothing on an unowned mailbox",
      at(STRANGER_CHIEF, box({ botId: null })),
      "denied",
    ],
    [
      "the mailbox of another person is refused even for the owner bot's id",
      at(OWNER_BOT, box({ ownerUserId: OTHER_PERSON })),
      "denied",
    ],
    [
      "a call made for another person is refused",
      at(OWNER_BOT, box(), "chat", OTHER_PERSON),
      "denied",
    ],
  ];
  for (const [name, input, want] of who) test(name, () => expect(mailAccess(input)).toBe(want));

  test("a refusal does not say why: every one of them is the same answer", () => {
    const refusals = who.filter(([, , w]) => w === "denied").map(([, i]) => mailAccess(i));
    expect(new Set(refusals)).toEqual(new Set(["denied"]));
  });
});

describe("where the turn runs", () => {
  const turns: [PluginTurn | null, MailAccess][] = [
    ["chat", "read"],
    ["loop", "read"],
    ["server", "read"],
    ["outside_event", "denied"],
    ["room", "denied"],
    ["inbound", "denied"],
    ["none", "denied"],
    [null, "denied"],
  ];
  for (const [turn, want] of turns)
    test(`the owner bot in a turn of kind ${turn ?? "(not said)"} -> ${want}`, () => {
      expect(mailAccess(at(OWNER_BOT, box(), turn))).toBe(want);
      expect(mailAccess(at(CHIEF, box({ botId: null }), turn))).toBe(want);
    });
  test("the allowed turns are exactly the ones listed", () => {
    expect([...MAIL_TURNS].sort()).toEqual(["chat", "loop", "server"]);
  });
});

describe("the state of the mailbox", () => {
  const states: [MailboxState, MailAccess][] = [
    ["active", "read"],
    ["error", "read"],
    ["needs_auth", "needs_auth"],
    ["retired", "denied"],
  ];
  for (const [state, want] of states)
    test(`${state} -> ${want}`, () => {
      expect(mailAccess(at(OWNER_BOT, box({ state })))).toBe(want);
      expect(mailAccess(at(CHIEF, box({ state, botId: null })))).toBe(want);
    });
  test("a state never opens what the owner rule closed", () => {
    for (const state of ["active", "error", "needs_auth", "retired"] as const)
      expect(mailAccess(at(SIBLING, box({ state })))).toBe("denied");
  });
});

describe("who may read a mailbox through an MCP client", () => {
  const person = (over: Partial<{ ownerUserId: string; state: MailboxState }> = {}, actor = ME) =>
    personMailAccess({
      actorUserId: actor,
      mailbox: { ownerUserId: ME, state: "active", ...over },
    });
  test("the person reads their own mailbox, whichever bot owns it", () => {
    expect(person()).toBe("read");
  });
  test("a mailbox that needs its password again says so", () => {
    expect(person({ state: "needs_auth" })).toBe("needs_auth");
  });
  test("another person's mailbox, active or not, is denied", () => {
    expect(person({}, OTHER_PERSON)).toBe("denied");
    expect(person({ state: "needs_auth" }, OTHER_PERSON)).toBe("denied");
    expect(person({ state: "error" }, OTHER_PERSON)).toBe("denied");
  });
  test("a retired mailbox is denied", () => {
    expect(person({ state: "retired" })).toBe("denied");
  });
});

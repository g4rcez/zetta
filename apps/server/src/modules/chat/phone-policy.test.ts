import { describe, expect, test } from "bun:test";

import {
  asksToCall,
  callMinutes,
  inCallingHours,
  isEmergencyNumber,
  numberNamedIn,
  phoneBlock,
  phoneCallMode,
  phoneCardOnlyGate,
  phoneGateFor,
  type BlockInput,
  type PhoneCallFacts,
  type PhoneTurnFacts,
} from "./phone-policy";

// Fictional numbers: +1 202 555 01xx and +55 11 5555 01xx are in the ranges reserved for fiction and libphonenumber treats them as valid.
const US = "+12025550123";
const US2 = "+12125550142";
const BR = "+551155550123";
const OWNER = "+5511955550123";
const BOT = "+14155550100";
// Examples of the premium-rate and toll-free types as libphonenumber classifies them: +1 900 555 0142 (premium), +44 909 879 0000 (premium).
const PREMIUM_US = "+19005550142";
const PREMIUM_GB = "+449098790000";

const limits = {
  countries: ["US", "BR", "GB"],
  maxCallMinutes: 30,
  dailyMinutesPerBot: 60,
  dailyCallsPerBot: 20,
};
const block = (over: Partial<BlockInput> = {}): BlockInput => ({
  to: US,
  botNumbers: new Set([BOT]),
  optedOut: false,
  limits,
  used: { calls: 0, seconds: 0 },
  ...over,
});

const turn = (over: Partial<PhoneTurnFacts> = {}): PhoneTurnFacts => ({
  place: "chat",
  personText: `Call ${US} and ask if the order arrived`,
  readElsewhere: false,
  phoneAttempts: 0,
  ...over,
});
const facts = (over: Partial<PhoneCallFacts> = {}, to = US): PhoneCallFacts => ({
  number: { status: "active", outbound: "on" },
  provider: "ready",
  busy: false,
  ownerNumber: OWNER,
  to,
  block: phoneBlock(block({ to })),
  ...over,
});
// 2026-11-23 is a Monday. 18:00 UTC is 13:00 in New York, 10:00 in Los Angeles and 15:00 in Sao Paulo.
const DAY = new Date("2026-11-23T18:00:00Z");
// 03:00 UTC: 22:00 the evening before in New York, midnight in Sao Paulo.
const NIGHT = new Date("2026-11-23T03:00:00Z");
const mode = (t: Partial<PhoneTurnFacts>, c: Partial<PhoneCallFacts> = {}, now = DAY, to = US) =>
  phoneCallMode(turn(t), facts(c, to), now);

describe("phoneCallMode: a call without a card needs every fact", () => {
  test("asked and the number written by the person: call", () => {
    expect(mode({})).toEqual({ mode: "call" });
  });
  test("asked, number with the usual separators: call", () => {
    expect(mode({ personText: "please call +1 (202) 555-0123 and say hi" }).mode).toBe("call");
  });
  test("the owner's own registered number: call, without writing it", () => {
    expect(mode({ personText: "Call me to talk about the report" }, {}, DAY, OWNER).mode).toBe(
      "call",
    );
    expect(mode({ personText: "ligue para mim" }, {}, NIGHT, OWNER).mode).toBe("call");
  });
  test("the number appears only in a mail, a page or a tool result: card", () => {
    expect(mode({ personText: "Call the dentist to confirm" }).mode).toBe("card");
    expect(mode({ personText: `Call ${US2}` }).mode).toBe("card");
  });
  test("a number written inside a longer number does not count", () => {
    expect(mode({ personText: `Call 9${US.slice(1)}1` }).mode).toBe("card");
  });
  test("not asked: card", () => {
    expect(mode({ personText: `Should I call ${US}?` }).mode).toBe("card");
    expect(mode({ personText: `The number is ${US}` }).mode).toBe("card");
    expect(mode({ personText: `Draft what to say when calling ${US}` }).mode).toBe("card");
  });
  test("the turn read outside content first: card", () => {
    expect(mode({ readElsewhere: true }).mode).toBe("card");
  });
  test("a loop, a routine or a turn Zetta started: card (never a direct call)", () => {
    expect(mode({ place: "loop" }).mode).toBe("card");
    expect(mode({ place: "server" }).mode).toBe("card");
  });
  test("a room, an inbound chat, an outside event, a call's own turn and no turn: the tool does not exist, so it is refused", () => {
    for (const place of ["room", "inbound", "outside_event", "none", undefined] as const)
      expect(mode({ place })).toEqual({ mode: "refuse", reason: "not_here" });
  });
  test("the card-only gate never calls", () => {
    const g = phoneCardOnlyGate("chat");
    expect(g.decide(facts(), DAY).mode).toBe("card");
  });
  test("the gate counts calls and cards of the turn and stops the third", () => {
    const t = turn();
    const g = phoneGateFor(t);
    expect(g.decide(facts(), DAY).mode).toBe("call");
    g.record();
    g.record();
    expect(g.decide(facts(), DAY)).toEqual({ mode: "refuse", reason: "turn_limit" });
  });
});

describe("phoneCallMode: refusals", () => {
  test("no number, a number not active, outbound off, no provider, busy", () => {
    expect(mode({}, { number: undefined }).reason).toBe("no_number");
    expect(mode({}, { number: { status: "pending_review", outbound: "on" } }).reason).toBe(
      "not_active",
    );
    expect(mode({}, { number: { status: "held", outbound: "on" } }).reason).toBe("not_active");
    expect(mode({}, { number: { status: "active", outbound: "off" } }).reason).toBe("outbound_off");
    expect(mode({}, { provider: "off" }).reason).toBe("no_provider");
    expect(mode({}, { busy: true }).reason).toBe("busy");
  });
  test("a hard block wins over a request, a card and the owner's number", () => {
    const c = { block: phoneBlock(block({ to: PREMIUM_US })) };
    expect(mode({ personText: `Call ${PREMIUM_US}` }, c, DAY, PREMIUM_US)).toEqual({
      mode: "refuse",
      reason: "premium_rate",
    });
    expect(mode({ place: "loop" }, c, DAY, PREMIUM_US).reason).toBe("premium_rate");
  });
});

describe("calling hours (08:00 to 20:00 where the person called lives)", () => {
  test("a call the person did not ask for, at night there: refused", () => {
    expect(mode({ place: "loop" }, {}, NIGHT).reason).toBe("outside_hours");
    expect(mode({ place: "server" }, {}, NIGHT).reason).toBe("outside_hours");
  });
  test("the same call in the daytime: a card", () => {
    expect(mode({ place: "loop" }, {}, DAY).mode).toBe("card");
  });
  test("a call the person asked for now is never held to them, even with a card", () => {
    expect(mode({ personText: "Call the dentist" }, {}, NIGHT).mode).toBe("card");
    expect(mode({}, {}, NIGHT).mode).toBe("call");
  });
  test("the owner's own number is never held to them", () => {
    expect(mode({ place: "loop" }, {}, NIGHT, OWNER).mode).toBe("card");
  });
  test("destination time zones, with a fixed clock", () => {
    // Monday 22:30 UTC: 17:30 in New York, 14:30 in Los Angeles, 19:30 in Sao Paulo, 22:30 in London.
    const at = new Date("2026-11-23T22:30:00Z");
    expect(inCallingHours("+442071838750", at)).toBe(false); // London 22:30
    expect(inCallingHours(BR, at)).toBe(true); // Sao Paulo 19:30
    expect(inCallingHours(US, at)).toBe(true); // New York 17:30 and Los Angeles 14:30
    // 15:00 UTC is 07:00 in Los Angeles: a country with several zones is held to all of them.
    expect(inCallingHours(US, new Date("2026-11-23T15:00:00Z"))).toBe(false);
    expect(inCallingHours(US, new Date("2026-11-23T18:00:00Z"))).toBe(true);
    // Edges: 08:00 is in, 20:00 is out (Sao Paulo is UTC-3 in November).
    expect(inCallingHours(BR, new Date("2026-11-23T11:00:00Z"))).toBe(true);
    expect(inCallingHours(BR, new Date("2026-11-23T10:59:00Z"))).toBe(false);
    expect(inCallingHours(BR, new Date("2026-11-23T22:59:00Z"))).toBe(true);
    expect(inCallingHours(BR, new Date("2026-11-23T23:00:00Z"))).toBe(false);
    // An area code in another zone (Manaus, UTC-4): 11:00 UTC is 07:00 there.
    expect(inCallingHours("+5592999990000", new Date("2026-11-23T11:00:00Z"))).toBe(false);
    expect(inCallingHours("+5592999990000", new Date("2026-11-23T12:00:00Z"))).toBe(true);
    // A country the table does not know cannot be checked: closed.
    expect(inCallingHours("+8613800000000", at)).toBe(false);
  });
});

describe("phoneBlock: hard blocks and limits", () => {
  const why = (over: Partial<BlockInput>) => phoneBlock(block(over)).reason;
  test("a good number passes and is described", () => {
    expect(phoneBlock(block())).toEqual({
      e164: US,
      country: "US",
      type: "FIXED_LINE_OR_MOBILE",
      reason: undefined,
    });
    expect(phoneBlock(block({ to: " +55 (11) 5555-0123 " })).e164).toBe(BR);
  });
  test.each([
    "190",
    "192",
    "193",
    "199",
    "112",
    "911",
    "999",
    "000",
    "+1 988",
    "+190",
    "+112",
    "+911",
    "+55190",
    "+55 192",
    "+1 911",
    "+44 999",
    "0055 190",
    "+351112",
    "+49110",
    "+81119",
    "+54107",
    "+61000",
  ])("emergency number %s is blocked", (n) => {
    expect(isEmergencyNumber(n)).toBe(true);
    expect(why({ to: n })).toBe("emergency");
  });
  test("emergency numbers are blocked even with the other rules satisfied", () => {
    expect(why({ to: "190", limits: { ...limits, countries: ["BR"] } })).toBe("emergency");
  });
  test("a real number that merely contains emergency digits is not one", () => {
    expect(isEmergencyNumber(US)).toBe(false);
    expect(isEmergencyNumber("+5511911234567")).toBe(false);
  });
  test.each([
    "",
    "hello",
    "5511955550123",
    "+0123456789",
    "+12",
    "+1202555012345678",
    "+1 202 555",
    "tel:+12025550123",
  ])("not an E.164 number: %p", (n) => expect(why({ to: n })).toBe("invalid_number"));
  test("well formed but not a number that exists (libphonenumber says invalid)", () => {
    expect(why({ to: "+19765550100" })).toBe("invalid_number");
  });
  test("another bot's number of this installation (a call loop)", () => {
    expect(why({ to: BOT })).toBe("own_bot_number");
  });
  test("a number on the do-not-call list", () => {
    expect(why({ optedOut: true })).toBe("opted_out");
  });
  test("premium-rate and shared-cost destinations", () => {
    expect(why({ to: PREMIUM_US })).toBe("premium_rate");
    expect(why({ to: PREMIUM_GB })).toBe("premium_rate");
    expect(why({ to: "+559003334444" })).toBe("premium_rate");
  });
  test("toll-free numbers are ordinary destinations", () => {
    expect(why({ to: "+18885550142" })).toBeUndefined();
  });
  test("a country the operator did not allow, and an empty list allows none", () => {
    expect(why({ limits: { ...limits, countries: ["BR"] } })).toBe("country_not_allowed");
    expect(why({ limits: { ...limits, countries: [] } })).toBe("country_not_allowed");
    expect(why({ to: "+34600000000" })).toBe("country_not_allowed");
  });
  test("the daily limits", () => {
    expect(why({ used: { calls: 20, seconds: 0 } })).toBe("daily_calls");
    expect(why({ used: { calls: 19, seconds: 0 } })).toBeUndefined();
    expect(why({ used: { calls: 0, seconds: 3600 } })).toBe("daily_minutes");
    expect(why({ used: { calls: 0, seconds: 3599 } })).toBeUndefined();
    expect(
      why({ used: { calls: 0, seconds: 0 }, limits: { ...limits, dailyCallsPerBot: 0 } }),
    ).toBe("daily_calls");
  });
  test("the order of the blocks: emergency, invalid, bot number, opt-out, premium, country, limits", () => {
    expect(why({ to: PREMIUM_US, optedOut: true })).toBe("opted_out");
    expect(why({ to: BOT, optedOut: true })).toBe("own_bot_number");
  });
});

describe("callMinutes", () => {
  test("defaults, the cap per call and what is left of the day", () => {
    const used = { calls: 0, seconds: 0 };
    expect(callMinutes(undefined, limits, used)).toBe(5);
    expect(callMinutes(10, limits, used)).toBe(10);
    expect(callMinutes(500, limits, used)).toBe(30);
    expect(callMinutes(0, limits, used)).toBe(5);
    expect(callMinutes(Number.NaN, limits, used)).toBe(5);
    expect(callMinutes(20, limits, { calls: 1, seconds: 3000 })).toBe(10);
    expect(callMinutes(20, limits, { calls: 1, seconds: 3590 })).toBe(1);
  });
});

describe("numberNamedIn", () => {
  test("whole numbers only", () => {
    expect(numberNamedIn("ring +12025550123 now", US)).toBe(true);
    expect(numberNamedIn("ring 1 202 555 0123 now", US)).toBe(true); // the whole number with its country code, no plus
    expect(numberNamedIn("ring 202 555 0123 now", US)).toBe(false); // no country: not the number
    expect(numberNamedIn("ring 0012025550123 now", US)).toBe(true);
    expect(numberNamedIn("ring +12025550124", US)).toBe(false);
    expect(numberNamedIn("order +120255501234", US)).toBe(false);
  });
});

describe("asksToCall", () => {
  test.each([
    "Call +1 202 555 0123",
    "call the dentist at +1 202 555 0123",
    "Please phone him and ask",
    "ring Ana",
    "dial +1 202 555 0123",
    "give Ana a call",
    "Can you call my mother?",
    "could you call them tomorrow",
    "I want you to call the shop",
    "make a call to the bank",
    "read it and then call him",
    "Ligue para o João",
    "liga pra ele agora",
    "por favor ligue para +55 11 5555-0123",
    "Pode ligar para a loja?",
    "quero que você ligue para ele",
    "telefone para a clínica",
    "faça uma ligação para o banco",
    "Llama a Ana",
    "llame al banco por favor",
    "¿Puedes llamar a mi madre?",
    "quiero que llames a Pedro",
    "telefonea a la tienda",
    "haz una llamada al médico",
    "marca al +34 600 000 000",
    "call me",
    "ligue para mim",
    "llámame",
  ])("asks: %s", (t) => expect(asksToCall(t)).toBe(true));

  test.each([
    "",
    "Should I call him?",
    "did Ana call?",
    "what number do I call for support?",
    "Don't call anyone",
    "never call the bank",
    "draft what to say when you call",
    "wait until I say before you call",
    "the call from Ana was long",
    "call history for today",
    "I will call them myself",
    "tell Ana to call me",
    "ask him to phone me later",
    "Devo ligar para ele?",
    "não ligue para ninguém",
    "me ligou ontem",
    "a ligação de ontem caiu",
    "rascunho do que dizer na ligação",
    "¿Debo llamar al banco?",
    "no llames a nadie",
    "ayer me llamó Ana",
    "mi teléfono es +34 600 000 000",
    "email Ana and say hello",
    "summarize the call transcript",
    "when you call, say that the order is late",
  ])("does not ask: %s", (t) => expect(asksToCall(t)).toBe(false));

  test("known misses and false hits are kept visible", () => {
    // A command to "call" something that is not a phone call still reads as a request; the number must also be the person's, so it is a
    // card or a refusal, never a call to a stranger.
    expect(asksToCall("call it done")).toBe(true);
    // Reported speech before the verb is a miss (a card).
    expect(asksToCall("it would help if you could phone the bank")).toBe(false);
  });
});

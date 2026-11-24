import { describe, expect, test } from "bun:test";
import {
  baseSubject,
  groupConversations,
  isReplySubject,
  normalizeSubject,
  parseMessageIds,
  type ThreadMessage,
} from "./threading";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const msg = (
  key: string,
  o: Partial<Omit<ThreadMessage, "key">> & { day?: number } = {},
): ThreadMessage => ({
  key,
  messageId: o.messageId ?? `${key}@example.invalid`,
  inReplyTo: o.inReplyTo ?? [],
  references: o.references ?? [],
  subject: o.subject ?? `Subject of ${key}`,
  time: o.time ?? T0 + (o.day ?? 0) * DAY,
});
const keys = (groups: ThreadMessage[][]) => groups.map((g) => g.map((m) => m.key).join(",")).sort();

describe("parseMessageIds", () => {
  test("takes every <id>, lower case, ignoring the text around them", () => {
    expect(parseMessageIds("<A@Ex.invalid> junk <b@ex.invalid>\r\n <c@ex.invalid>")).toEqual([
      "a@ex.invalid",
      "b@ex.invalid",
      "c@ex.invalid",
    ]);
    expect(parseMessageIds(undefined)).toEqual([]);
    expect(parseMessageIds("no brackets")).toEqual([]);
  });
});

describe("subjects", () => {
  test.each([
    ["Re: Hello", true],
    ["RE: Hello", true],
    ["Re[2]: Hello", true],
    ["Aw: Hallo", true],
    ["Res: Olá", true],
    ["Fwd: Hello", false],
    ["Hello", false],
    ["Regarding the report", false],
  ])("isReplySubject(%p) is %p", (s, want) => expect(isReplySubject(s)).toBe(want));

  test("prefixes are stripped however many there are", () => {
    expect(normalizeSubject("Re: RE: Aw: Fwd: Lunch   Friday?")).toBe("lunch friday?");
    expect(baseSubject("Re: Re: Lunch Friday?")).toBe("Lunch Friday?");
  });
});

describe("groupConversations", () => {
  test("a reply chain of three is one conversation, oldest first", () => {
    const a = msg("a", { day: 0 });
    const b = msg("b", {
      day: 1,
      inReplyTo: ["a@example.invalid"],
      references: ["a@example.invalid"],
    });
    const c = msg("c", {
      day: 2,
      inReplyTo: ["b@example.invalid"],
      references: ["a@example.invalid", "b@example.invalid"],
    });
    const out = groupConversations([c, a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.map((m) => m.key)).toEqual(["a", "b", "c"]);
  });

  test("the message the others answer need not be in the set", () => {
    const b = msg("b", {
      references: ["gone@example.invalid"],
      inReplyTo: ["gone@example.invalid"],
    });
    const c = msg("c", {
      references: ["gone@example.invalid"],
      inReplyTo: ["gone@example.invalid"],
    });
    expect(keys(groupConversations([b, c]))).toEqual(["b,c"]);
  });

  test("ids match without regard to case", () => {
    const a = msg("a", { messageId: "Abc@Example.invalid" });
    const b = msg("b", { inReplyTo: ["abc@example.invalid"] });
    expect(keys(groupConversations([a, b]))).toEqual(["a,b"]);
  });

  test("a message whose references point nowhere known stays alone", () => {
    const a = msg("a", { subject: "Budget" });
    const lost = msg("lost", {
      subject: "Re: Budget",
      references: ["nope@example.invalid"],
      inReplyTo: ["nope@example.invalid"],
    });
    expect(keys(groupConversations([a, lost]))).toEqual(["a", "lost"]);
  });

  test("messages with no ids at all are each their own conversation", () => {
    const a = { ...msg("a"), messageId: "" };
    const b = { ...msg("b"), messageId: "" };
    expect(groupConversations([a, b])).toHaveLength(2);
  });

  test("a Re: without reference headers joins the same subject within 30 days", () => {
    const a = msg("a", { subject: "Lunch Friday?", day: 0 });
    const r = msg("r", { subject: "RE: lunch friday?", day: 2, messageId: "" });
    expect(keys(groupConversations([a, r]))).toEqual(["a,r"]);
  });

  test("the fallback stops at 30 days", () => {
    const a = msg("a", { subject: "Lunch Friday?", day: 0 });
    const ok = msg("ok", { subject: "Re: Lunch Friday?", day: 30, messageId: "" });
    const late = msg("late", { subject: "Re: Lunch Friday?", day: 31.5, messageId: "" });
    expect(keys(groupConversations([a, ok]))).toEqual(["a,ok"]);
    // `late` is 31.5 days after a, but only 1.5 after `ok`, which already joined a, so it follows the chain it can see.
    expect(keys(groupConversations([a, late]))).toEqual(["a", "late"]);
  });

  test("never joins on the subject alone: a new message with an old subject starts its own", () => {
    const a = msg("a", { subject: "Invoice", day: 0 });
    const b = msg("b", { subject: "Invoice", day: 1 });
    expect(keys(groupConversations([a, b]))).toEqual(["a", "b"]);
  });

  test("a forward is not a reply", () => {
    const a = msg("a", { subject: "Report", day: 0 });
    const f = msg("f", { subject: "Fwd: Report", day: 1 });
    expect(keys(groupConversations([a, f]))).toEqual(["a", "f"]);
  });

  test("a Re: whose headers point elsewhere is not pulled in by its subject", () => {
    const a = msg("a", { subject: "Plan", day: 0 });
    const other = msg("other", { subject: "Else", day: 0 });
    const r = msg("r", {
      subject: "Re: Plan",
      day: 1,
      inReplyTo: ["other@example.invalid"],
      references: ["other@example.invalid"],
    });
    expect(keys(groupConversations([a, other, r]))).toEqual(["a", "other,r"]);
  });

  test("the nearest earlier conversation of that subject wins", () => {
    const old = msg("old", { subject: "Status", day: 0 });
    const near = msg("near", { subject: "Status", day: 9 });
    const r = msg("r", { subject: "Re: Status", day: 10, messageId: "" });
    expect(keys(groupConversations([old, near, r]))).toEqual(["near,r", "old"]);
  });

  test("two replies to one message are in the same conversation", () => {
    const a = msg("a");
    const b = msg("b", { inReplyTo: ["a@example.invalid"] });
    const c = msg("c", { inReplyTo: ["a@example.invalid"] });
    expect(keys(groupConversations([a, b, c]))).toEqual(["a,b,c"]);
  });

  test("messages without a date sort first and do not break the fallback", () => {
    const a = msg("a", { subject: "X", time: NaN });
    const r = msg("r", { subject: "Re: X", messageId: "" });
    expect(groupConversations([a, r])).toHaveLength(2);
  });
});

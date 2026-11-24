import { describe, expect, test } from "bun:test";
import { headerBlock, headerOf, isAutomatic, newWords, startsTurn, vouchedBy } from "./poller";
import { addressFor } from "./provision";

const box = (o: Partial<Parameters<typeof startsTurn>[0]["mailbox"]> = {}) => ({
  address: "helper-1a2b@bots.example.invalid",
  state: "active" as const,
  botId: "bot-1",
  allowedSenders: ["ana@example.invalid", "@partner.example.invalid"],
  ...o,
});
const facts = (o: Partial<Parameters<typeof startsTurn>[0]> = {}) => ({
  mailbox: box(),
  from: "ana@example.invalid",
  authentication: { spf: "fail", dkim: "pass", dmarc: "pass" },
  automatic: false,
  ...o,
});

describe("startsTurn", () => {
  test("an allowed sender the provider vouches for starts a turn (dkim or spf)", () => {
    expect(startsTurn(facts())).toBe(true);
    expect(startsTurn(facts({ authentication: { spf: "pass", dkim: "fail" } }))).toBe(true);
    expect(startsTurn(facts({ from: "Bob@Partner.example.invalid" }))).toBe(true);
  });
  test("failed or unknown authentication starts none", () => {
    expect(
      startsTurn(facts({ authentication: { spf: "fail", dkim: "fail", dmarc: "fail" } })),
    ).toBe(false);
    expect(startsTurn(facts({ authentication: { spf: "unknown", dkim: "unknown" } }))).toBe(false);
    expect(startsTurn(facts({ authentication: {} }))).toBe(false);
    // DMARC alone does not vouch: the rule is the e-mail plugin's (dkim=pass or spf=pass).
    expect(startsTurn(facts({ authentication: { dmarc: "pass" } }))).toBe(false);
  });
  test("an unlisted sender starts none, and an empty list lets nobody in", () => {
    expect(startsTurn(facts({ from: "mallory@evil.example.invalid" }))).toBe(false);
    expect(startsTurn(facts({ mailbox: box({ allowedSenders: [] }) }))).toBe(false);
  });
  test("automatic mail and the mailbox's own address start none", () => {
    expect(startsTurn(facts({ automatic: true }))).toBe(false);
    expect(
      startsTurn(
        facts({
          from: "HELPER-1A2B@bots.example.invalid",
          mailbox: box({ allowedSenders: ["@bots.example.invalid"] }),
        }),
      ),
    ).toBe(false);
  });
  test("a retired mailbox or one with no owner bot starts none", () => {
    expect(startsTurn(facts({ mailbox: box({ state: "retired" }) }))).toBe(false);
    expect(startsTurn(facts({ mailbox: box({ botId: null }) }))).toBe(false);
  });
  test("a sender that is not an address starts none", () => {
    expect(startsTurn(facts({ from: "" }))).toBe(false);
    expect(startsTurn(facts({ from: "not an address" }))).toBe(false);
  });
});

describe("isAutomatic", () => {
  const block = (h: string) =>
    headerBlock(Buffer.from(`${h}\r\nFrom: a@example.invalid\r\n\r\nbody`));
  test("bounces, lists and auto-replies", () => {
    expect(isAutomatic(block("Auto-Submitted: auto-replied"))).toBe(true);
    expect(isAutomatic(block("Auto-Submitted: auto-generated"))).toBe(true);
    expect(isAutomatic(block("Precedence: bulk"))).toBe(true);
    expect(isAutomatic(block("Precedence: list"))).toBe(true);
    expect(isAutomatic(block("List-Id: <news.example.invalid>"))).toBe(true);
    expect(isAutomatic(block("List-Unsubscribe: <mailto:x@example.invalid>"))).toBe(true);
    expect(isAutomatic(block("X-Auto-Response-Suppress: All"))).toBe(true);
    expect(isAutomatic(block("Return-Path: <>"))).toBe(true);
  });
  test("a person's mail is not automatic", () => {
    expect(isAutomatic(block("Auto-Submitted: no"))).toBe(false);
    expect(isAutomatic(block("Return-Path: <ana@example.invalid>"))).toBe(false);
    expect(isAutomatic(block("Subject: hello"))).toBe(false);
  });
  test("a header inside the body does not count", () => {
    const raw = Buffer.from("Subject: hi\r\n\r\nPrecedence: bulk\r\nList-Id: x\r\n");
    expect(isAutomatic(headerBlock(raw))).toBe(false);
  });
});

describe("helpers", () => {
  test("headerBlock unfolds and stops at the blank line", () => {
    const b = headerBlock(Buffer.from("Subject: a\r\n b\r\nX: 1\r\n\r\nSubject: nope"));
    expect(headerOf(b, "subject")).toBe("a b");
    expect(headerOf(b, "x")).toBe("1");
  });
  test("vouchedBy", () => {
    expect(vouchedBy({ dkim: "pass" })).toBe(true);
    expect(vouchedBy({ spf: "pass" })).toBe(true);
    expect(vouchedBy({ spf: "fail", dkim: "gray" })).toBe(false);
  });
  test("newWords drops the quoted thread", () => {
    expect(newWords("Yes, 5pm.\n\nOn Mon, Nov 2, 2026 Ana wrote:\n> old\n")).toBe("Yes, 5pm.");
    expect(newWords("Line\n> quoted\nOther")).toBe("Line\nOther");
  });
});

describe("addressFor", () => {
  test("slug, a dash and the last characters of the random text, lower case", () => {
    expect(
      addressFor("helper", "Bots.Example.invalid", 4, "0192f000-0000-7000-8000-00000000ABCD"),
    ).toBe("helper-abcd@bots.example.invalid");
    expect(
      addressFor("helper", "bots.example.invalid", 6, "0192f000-0000-7000-8000-0000ABCDEF12"),
    ).toBe("helper-cdef12@bots.example.invalid");
  });
  test("the local part is at most 64 characters", () => {
    const slug = "a".repeat(48);
    const local = addressFor(slug, "bots.example.invalid", 8).split("@")[0]!;
    expect(local.length).toBeLessThanOrEqual(64);
    expect(local.startsWith(slug)).toBe(true);
    expect(addressFor("x".repeat(100), "b.example.invalid", 8).split("@")[0]!.length).toBe(64);
  });
  test("only letters, digits and dashes", () => {
    expect(
      addressFor("Hel_per.bot", "b.example.invalid", 4, "00000000-0000-7000-8000-00000000abcd"),
    ).toBe("helperbot-abcd@b.example.invalid");
  });
});

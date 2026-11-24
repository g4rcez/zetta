import { describe, expect, test } from "bun:test";
import { PIN_MAX_FAILURES } from "@zetta/core/phone";
import { decidePin, hashPin } from "./pin";
import { PHONE_CALL_LIMITS, createPinCollector, decideStart, type StartFacts } from "./plan";

const OWNER = "+15550100001";
const facts = (o: Partial<StartFacts> = {}): StartFacts => ({
  numberStatus: "active",
  inbound: "anyone",
  from: "+15550100999",
  ownerNumber: OWNER,
  pinSet: true,
  pinLocked: false,
  busy: false,
  overLimit: false,
  ...o,
});

describe("what happens to a call", () => {
  test("a number that is held, off or not active is not in service, whoever calls", () => {
    for (const o of [
      { numberStatus: "held" as const },
      { numberStatus: "pending_review" as const },
      { inbound: "off" as const },
      { numberStatus: "held" as const, from: OWNER },
    ])
      expect(decideStart(facts(o))).toEqual({ kind: "closed", sentence: "notInService" });
  });
  test("owner_only turns away anyone who is not the owner's number with a PIN to try", () => {
    expect(decideStart(facts({ inbound: "owner_only" }))).toEqual({
      kind: "closed",
      sentence: "ownerOnly",
    });
    expect(decideStart(facts({ inbound: "owner_only", from: OWNER, pinSet: false }))).toEqual({
      kind: "closed",
      sentence: "ownerOnly",
    });
    expect(decideStart(facts({ inbound: "owner_only", from: OWNER, pinLocked: true }))).toEqual({
      kind: "closed",
      sentence: "ownerOnly",
    });
    expect(decideStart(facts({ inbound: "owner_only", from: OWNER }))).toEqual({
      kind: "pin",
      inbound: "owner_only",
    });
  });
  test("caller ID alone is never the owner: the owner's number only means the PIN is asked", () => {
    expect(decideStart(facts({ from: OWNER }))).toEqual({ kind: "pin", inbound: "anyone" });
    // no PIN set: the same number is just another caller
    expect(decideStart(facts({ from: OWNER, pinSet: false }))).toEqual({ kind: "outside" });
    expect(decideStart(facts({ from: null }))).toEqual({ kind: "outside" });
  });
  test("a busy bot says so, and the day's limit stops outsiders but not the owner's own number", () => {
    expect(decideStart(facts({ busy: true }))).toEqual({ kind: "closed", sentence: "busy" });
    expect(decideStart(facts({ overLimit: true }))).toEqual({ kind: "closed", sentence: "limit" });
    expect(decideStart(facts({ overLimit: true, from: OWNER }))).toEqual({
      kind: "pin",
      inbound: "anyone",
    });
  });
  test("the limits are the decided ones", () => {
    expect(PHONE_CALL_LIMITS.outsideMaxMs).toBe(5 * 60_000);
    expect(PHONE_CALL_LIMITS.silenceMs).toBe(20_000);
  });
});

describe("the keypad PIN", () => {
  test("digits are sent with #, * clears, eight digits send themselves", () => {
    const c = createPinCollector();
    expect(c.push("1")).toEqual({ kind: "none" });
    expect(c.push("2")).toEqual({ kind: "none" });
    expect(c.push("*")).toEqual({ kind: "none" });
    for (const d of "4321") c.push(d);
    expect(c.push("#")).toEqual({ kind: "submit", pin: "4321" });
    expect(c.push("#")).toEqual({ kind: "submit", pin: "" });
    let last = c.push("1");
    for (const d of "2345678") last = c.push(d);
    expect(last).toEqual({ kind: "submit", pin: "12345678" });
    expect(c.push("A")).toEqual({ kind: "none" });
  });
  test("three wrong tries lock the PIN, and the right one is then refused too", async () => {
    let state = {
      pinHash: await hashPin("4321"),
      pinFailures: 0,
      pinLockedUntil: null as Date | null,
    };
    const t = new Date("2026-11-23T10:00:00Z");
    for (let i = 0; i < PIN_MAX_FAILURES; i++) {
      const o = await decidePin(state, "0000", t);
      expect(o.result).toBe("wrong");
      state = {
        pinHash: state.pinHash,
        pinFailures: o.pinFailures,
        pinLockedUntil: o.pinLockedUntil,
      };
    }
    expect(state.pinLockedUntil).not.toBeNull();
    expect((await decidePin(state, "4321", t)).result).toBe("locked");
    // the lock ends: the right PIN passes again
    const later = new Date(t.getTime() + 31 * 60_000);
    expect((await decidePin(state, "4321", later)).result).toBe("ok");
  });
});

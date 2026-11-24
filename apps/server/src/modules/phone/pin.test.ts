import { describe, expect, test } from "bun:test";
import { decidePin, hashPin, isPin, verifyPinHash, type PinState } from "./pin";

const T0 = new Date("2026-11-23T12:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("PIN hashing", () => {
  test("a PIN is four to eight digits", () => {
    for (const good of ["1234", "12345678", "0000"]) expect(isPin(good)).toBe(true);
    for (const bad of ["123", "123456789", "12a4", "", " 1234", "12 34"])
      expect(isPin(bad)).toBe(false);
  });

  test("the hash is salted, never holds the PIN, and checks the right one only", async () => {
    const a = await hashPin("4821");
    const b = await hashPin("4821");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(a).not.toContain("4821");
    expect(await verifyPinHash("4821", a)).toBe(true);
    expect(await verifyPinHash("4822", a)).toBe(false);
    expect(await verifyPinHash("4821", "plain")).toBe(false);
  });
});

describe("lockout after three wrong tries", () => {
  const fresh = async (): Promise<PinState> => ({
    pinHash: await hashPin("4821"),
    pinFailures: 0,
    pinLockedUntil: null,
  });
  const apply = (s: PinState, o: Awaited<ReturnType<typeof decidePin>>): PinState => ({
    pinHash: s.pinHash,
    pinFailures: o.pinFailures,
    pinLockedUntil: o.pinLockedUntil,
  });

  test("no PIN set answers none", async () => {
    expect(
      (await decidePin({ pinHash: null, pinFailures: 0, pinLockedUntil: null }, "4821", T0)).result,
    ).toBe("none");
  });

  test("the right PIN opens and clears the count", async () => {
    let s = await fresh();
    s = apply(s, await decidePin(s, "0000", T0));
    expect(s.pinFailures).toBe(1);
    const ok = await decidePin(s, "4821", T0);
    expect(ok).toEqual({ result: "ok", pinFailures: 0, pinLockedUntil: null });
  });

  test("the third wrong try locks for half an hour, and the right PIN is refused while locked", async () => {
    let s = await fresh();
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = await decidePin(s, "1111", T0);
      results.push(o.result);
      s = apply(s, o);
    }
    expect(results).toEqual(["wrong", "wrong", "wrong"]);
    expect(s.pinLockedUntil).toEqual(minutes(30));
    const during = await decidePin(s, "4821", minutes(10));
    expect(during.result).toBe("locked");
    expect(during.pinLockedUntil).toEqual(minutes(30));
  });

  test("after the lock ends the PIN works again, and a wrong try starts a fresh count", async () => {
    let s = await fresh();
    for (let i = 0; i < 3; i++) s = apply(s, await decidePin(s, "1111", T0));
    expect((await decidePin(s, "4821", minutes(31))).result).toBe("ok");
    const wrong = await decidePin(s, "1111", minutes(31));
    expect(wrong).toMatchObject({ result: "wrong", pinFailures: 1, pinLockedUntil: null });
  });

  test("a PIN that is not digits is a wrong try, not an error", async () => {
    const s = await fresh();
    expect((await decidePin(s, "abcd", T0)).result).toBe("wrong");
  });
});

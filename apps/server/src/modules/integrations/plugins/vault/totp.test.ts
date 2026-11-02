import { describe, expect, test } from "bun:test";
import { base32, totp } from "./totp";

// RFC 6238 appendix B: seed "12345678901234567890" (SHA1), 8 digits.
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
describe("totp", () => {
  test("base32 decodes the RFC seed", () => {
    expect(base32(SEED).toString()).toBe("12345678901234567890");
  });
  test("matches the RFC 6238 SHA1 vectors", () => {
    for (const [t, code] of [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
    ] as const)
      expect(totp(`otpauth://totp/x?secret=${SEED}&digits=8`, t * 1000)).toBe(code);
  });
  test("a bare secret gives 6 digits; bad input throws", () => {
    expect(totp(SEED, 59_000)).toBe("287082");
    expect(() => totp("not base32!")).toThrow();
    expect(() => totp(`otpauth://hotp/x?secret=${SEED}`)).toThrow();
  });
});

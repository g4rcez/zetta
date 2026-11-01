import { describe, expect, test } from "bun:test";

import { toWidth } from "./resize-handle";

// The server rejects a width that is not an integer, so the handle must never give a fraction.
describe("toWidth", () => {
  test("rounds a fractional pointer position to a whole pixel", () => {
    expect(toWidth(231.5, 192, 360)).toBe(232);
  });

  test("stops at the minimum", () => {
    expect(toWidth(100.4, 192, 360)).toBe(192);
  });

  test("stops at the maximum", () => {
    expect(toWidth(400.7, 192, 360)).toBe(360);
  });
});

import { expect, test } from "bun:test";

import { countryName, formatPhone } from "./format";

test("numbers are grouped the way people read them, and never lose a digit", () => {
  expect(formatPhone("+12025550123")).toBe("+1 (202) 555-0123");
  expect(formatPhone("+551155550123")).toBe("+55 11 5555-0123");
  expect(formatPhone("+5511955550123")).toBe("+55 11 95555-0123");
  expect(formatPhone("+442071838750")).toBe("+44 207 183 875 0");
  for (const n of [
    "+12025550123",
    "+551155550123",
    "+5511955550123",
    "+442071838750",
    "+34600000000",
  ])
    expect(formatPhone(n).replace(/\D/g, "")).toBe(n.replace(/\D/g, ""));
});

test("anything that is not an E.164 number is shown as it is", () => {
  expect(formatPhone("190")).toBe("190");
  expect(formatPhone("hello")).toBe("hello");
  expect(formatPhone("")).toBe("");
});

test("countries get their name", () => {
  expect(countryName("US")).toBe("United States");
  expect(countryName("BR")).toBe("Brazil");
  expect(countryName("ZZZ")).toBe("ZZZ");
});

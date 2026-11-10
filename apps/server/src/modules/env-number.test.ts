import { expect, test } from "bun:test";
import { envNumber } from "./env-number";

test("an unset, blank or non-numeric value gives the default, never 0", () => {
  expect(envNumber(undefined, 8)).toBe(8);
  expect(envNumber("", 8)).toBe(8);
  expect(envNumber("   ", 8)).toBe(8);
  expect(envNumber("abc", 8)).toBe(8);
  expect(envNumber("Infinity", 8)).toBe(8);
});

test("a valid number is used, a value under the minimum gives the default", () => {
  expect(envNumber("12", 8)).toBe(12);
  expect(envNumber(" 12 ", 8)).toBe(12);
  expect(envNumber("0", 8)).toBe(8);
  expect(envNumber("-3", 8)).toBe(8);
});

test("min 0 keeps an explicit 0", () => {
  expect(envNumber("0", 8, 0)).toBe(0);
  expect(envNumber("", 8, 0)).toBe(8);
  expect(envNumber("-1", 8, 0)).toBe(8);
});

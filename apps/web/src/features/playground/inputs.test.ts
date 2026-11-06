import { expect, test } from "bun:test";

import { collectInputs, showValue, withDefaults } from "./inputs";
import type { InputSpec } from "./playground-api";

const specs: InputSpec[] = [
  { name: "who", type: "string", default: "World" },
  { name: "n", type: "number" },
  { name: "loud", type: "boolean", default: true },
  { name: "opts", type: "json" },
];

test("a form that was not touched gives the defaults", () => {
  expect(collectInputs(specs, {})).toEqual({ who: "World", loud: true });
});

test("fields are read by their type", () => {
  expect(collectInputs(specs, { who: "Ada", n: "4.5", loud: false, opts: '{"a":[1]}' })).toEqual({
    who: "Ada",
    n: 4.5,
    loud: false,
    opts: { a: [1] },
  });
});

test("a number or JSON that cannot be read says which input", () => {
  expect(() => collectInputs(specs, { n: "abc" })).toThrow('Input "n" must be a number.');
  expect(() => collectInputs(specs, { opts: "{" })).toThrow('Input "opts" must be valid JSON.');
});

test("a saved input keeps the value on screen as its default, and an empty one has none", () => {
  expect(withDefaults(specs, { who: "Ada", n: "7" })).toEqual([
    { name: "who", type: "string", default: "Ada" },
    { name: "n", type: "number", default: 7 },
    { name: "loud", type: "boolean", default: true },
    { name: "opts", type: "json" },
  ]);
});

test("a value is shown as text for the form", () => {
  expect(showValue(specs[1]!, 3)).toBe("3");
  expect(showValue(specs[3]!, { a: 1 })).toBe('{"a":1}');
  expect(showValue(specs[2]!, undefined)).toBe(false);
});

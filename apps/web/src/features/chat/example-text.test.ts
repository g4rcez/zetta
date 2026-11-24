import { expect, test } from "bun:test";

import { withExample } from "./example-text";

test("an empty or blank box takes the example", () => {
  expect(withExample("", "Find mail about …")).toBe("Find mail about …");
  expect(withExample("  \n ", "Find mail about …")).toBe("Find mail about …");
});

test("a box with text keeps it and gets the example on a new line", () => {
  expect(withExample("what did Rui send?", "Find mail about …")).toBe(
    "what did Rui send?\nFind mail about …",
  );
  expect(withExample("one\n\n", "two")).toBe("one\ntwo");
});

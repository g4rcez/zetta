import { expect, test } from "bun:test";

import { parseRoutinesSearch } from "./routines-search";

test("keeps what it understands, drops defaults and anything else", () => {
  expect(parseRoutinesSearch({})).toEqual({});
  expect(parseRoutinesSearch({ view: "calendar", hours: "24", junk: 1 })).toEqual({
    view: "calendar",
    hours: 24,
  });
  expect(parseRoutinesSearch({ view: "list", hours: 3, routine: "nope" })).toEqual({});
  const id = "01a1c66d-bf51-7c63-969c-b0842d09a4fe";
  expect(parseRoutinesSearch({ routine: id })).toEqual({ routine: id });
});

import { expect, test } from "bun:test";

import {
  parsePlaygroundSearch,
  parsePlaygroundsSearch,
  withPlaygroundsSearch,
  withPlaygroundSearch,
} from "./playground-search";

test("the list keeps the search text and the team scope, and drops what it does not understand", () => {
  expect(parsePlaygroundsSearch({ q: "  report ", scope: "team", other: "x" })).toEqual({
    q: "report",
    scope: "team",
  });
  expect(parsePlaygroundsSearch({ q: "", scope: "all" })).toEqual({});
});

test("a change that restores a default leaves the address", () => {
  expect(withPlaygroundsSearch({ q: "a", scope: "team" }, { scope: undefined })).toEqual({
    q: "a",
  });
});

test("a playground keeps the open file and a valid run id", () => {
  const run = "01a1ad9d-5f98-7d51-b398-b0a52443a908";
  expect(parsePlaygroundSearch({ file: "lib/greet.ts", run })).toEqual({
    file: "lib/greet.ts",
    run,
  });
  expect(parsePlaygroundSearch({ file: "", run: "latest" })).toEqual({});
  expect(withPlaygroundSearch({ file: "a.ts", run }, { run: undefined })).toEqual({ file: "a.ts" });
  expect(parsePlaygroundSearch({ panel: "inputs" })).toEqual({ panel: "inputs" });
  expect(parsePlaygroundSearch({ panel: "output" })).toEqual({});
});

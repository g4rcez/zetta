import { describe, expect, test } from "bun:test";

import { filterSettings, parseSettingsSearch, type SettingFilterRow } from "./settings-filters";

describe("parseSettingsSearch", () => {
  test("an empty address is the default view", () => {
    expect(parseSettingsSearch({})).toEqual({});
  });
  test("keeps a known group, the changed filter and a text", () => {
    expect(parseSettingsSearch({ group: "limits", show: "changed", q: "  runs " })).toEqual({
      group: "limits",
      show: "changed",
      q: "runs",
    });
  });
  test("leaves the defaults out of the address", () => {
    expect(parseSettingsSearch({ show: "all", q: "   " })).toEqual({});
  });
  test("drops what it does not understand", () => {
    expect(parseSettingsSearch({ group: "nope", show: "yes", q: 4, extra: "x" })).toEqual({});
    expect(parseSettingsSearch({ group: ["limits"], show: true })).toEqual({});
  });
  test("cuts a very long text", () => {
    expect(parseSettingsSearch({ q: "a".repeat(500) }).q).toHaveLength(100);
  });
});

const row = (over: Partial<SettingFilterRow>): SettingFilterRow => ({
  key: "harnessMax",
  label: "Runs at once",
  help: "How many bot runs may go at the same time.",
  group: "limits",
  source: "default",
  ...over,
});
const rows = [
  row({}),
  row({ key: "lightRuns", label: "Light background runs", group: "chat", source: "installation" }),
  row({ key: "codeAccess", label: "Code access", group: "security", source: "imported" }),
];

describe("filterSettings", () => {
  test("no filter keeps every row in order", () => {
    expect(filterSettings(rows, {}).map((r) => r.key)).toEqual([
      "harnessMax",
      "lightRuns",
      "codeAccess",
    ]);
  });
  test("a group keeps its own rows", () => {
    expect(filterSettings(rows, { group: "chat" }).map((r) => r.key)).toEqual(["lightRuns"]);
  });
  test("changed keeps what is not the default, imported included", () => {
    expect(filterSettings(rows, { show: "changed" }).map((r) => r.key)).toEqual([
      "lightRuns",
      "codeAccess",
    ]);
  });
  test("the text matches the name, the help and the key, in any case", () => {
    expect(filterSettings(rows, { q: "BACKGROUND" })).toHaveLength(1);
    expect(filterSettings(rows, { q: "same time" })).toHaveLength(3);
    expect(filterSettings(rows, { q: "codeaccess" })).toHaveLength(1);
  });
  test("the filters combine", () => {
    expect(filterSettings(rows, { group: "security", show: "changed", q: "code" })).toHaveLength(1);
    expect(filterSettings(rows, { group: "limits", show: "changed" })).toHaveLength(0);
  });
});

import { describe, expect, test } from "bun:test";

import {
  filterPlugins,
  parsePluginsSearch,
  pluginCounts,
  withPluginsSearch,
} from "./plugins-filters";

const catalog = [
  {
    id: "memory",
    name: "Memory notes",
    description: "Notes.",
    category: "knowledge",
    builtin: true,
  },
  { id: "botmail", name: "Bot e-mail", description: "Mail.", category: "messaging", builtin: true },
  { id: "github", name: "GitHub", description: "Code hosting.", category: "dev" },
  { id: "youtube", name: "YouTube downloader", description: "Save a video.", category: "other" },
  { id: "slack", name: "Slack", description: "Chat.", category: "messaging" },
];
const installed = new Set(["github"]);
const ids = (s: Parameters<typeof filterPlugins>[2]) =>
  filterPlugins(catalog, installed, s).map((m) => m.id);

describe("plugin filters", () => {
  test("installed (the default) holds only what the person installed or activated", () => {
    expect(ids({})).toEqual(["github"]);
    // Built in does not mean on: an activated built-in plugin joins the list like any other.
    expect(filterPlugins(catalog, new Set(["github", "botmail"]), {}).map((m) => m.id)).toEqual([
      "botmail",
      "github",
    ]);
  });

  test("built in holds the plugins that ship with Zetta, activated or not", () => {
    expect(ids({ status: "builtin" })).toEqual(["memory", "botmail"]);
    expect(
      filterPlugins(catalog, new Set(["botmail"]), { status: "builtin" }).map((m) => m.id),
    ).toEqual(["botmail", "memory"]);
  });

  test("available holds everything not installed, built-in plugins included; all keeps everything", () => {
    expect(ids({ status: "available" })).toEqual(["memory", "botmail", "youtube", "slack"]);
    expect(ids({ status: "all" })).toHaveLength(5);
  });

  test("status, category and words combine", () => {
    expect(ids({ status: "builtin", category: "messaging" })).toEqual(["botmail"]);
    expect(ids({ status: "all", category: "messaging", q: "  SLA " })).toEqual(["slack"]);
    expect(ids({ status: "builtin", q: "github" })).toEqual([]);
  });

  test("counts do not depend on the other filters", () => {
    expect(pluginCounts(catalog, installed)).toEqual({
      installed: 1,
      available: 4,
      builtin: 2,
      all: 5,
    });
  });
});

describe("plugin filters in the address", () => {
  test("defaults and nonsense leave the address", () => {
    expect(parsePluginsSearch({})).toEqual({});
    expect(parsePluginsSearch({ status: "installed", category: "all", q: "   " })).toEqual({});
    expect(parsePluginsSearch({ status: "everything", category: "Dev Tools!" })).toEqual({});
    expect(parsePluginsSearch({ q: 42, status: ["builtin"] })).toEqual({});
  });

  test("a status, a category and words are kept", () => {
    expect(parsePluginsSearch({ status: "builtin", category: "messaging", q: "mail" })).toEqual({
      status: "builtin",
      category: "messaging",
      q: "mail",
    });
  });

  test("the words stay as typed, so a space between two words is not swallowed", () => {
    expect(parsePluginsSearch({ q: "git hub " }).q).toBe("git hub ");
    expect(withPluginsSearch({}, { q: "git " }).q).toBe("git ");
  });

  test("choosing the default status or all categories removes them from the address", () => {
    expect(
      withPluginsSearch({ status: "builtin", category: "dev" }, { status: "installed" }),
    ).toEqual({ category: "dev" });
    expect(withPluginsSearch({ status: "builtin", category: "dev" }, { category: "all" })).toEqual({
      status: "builtin",
    });
    expect(withPluginsSearch({ q: "x" }, { status: "builtin" })).toEqual({
      q: "x",
      status: "builtin",
    });
  });
});

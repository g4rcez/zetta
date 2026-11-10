import { describe, expect, test } from "bun:test";
import { matchIntegrations } from "./integrations-match";

const plugins = [
  { id: "google", name: "Google" },
  { id: "github", name: "GitHub" },
  { id: "linear", name: "Linear" },
  { id: "notion", name: "Notion" },
  { id: "chrome-devtools", name: "Chrome DevTools" },
  { id: "onepassword", name: "1Password" },
  { id: "homeassistant", name: "Home Assistant" },
  { id: "telegram", name: "Telegram" },
  { id: "apps", name: "Apps" },
  { id: "composio", name: "Composio" },
];
const match = (name: string, list = plugins) =>
  matchIntegrations([{ name, description: "d" }], list)[0]!.pluginId;

describe("matchIntegrations", () => {
  test("keeps the name and description and adds the plugin id", () => {
    expect(
      matchIntegrations([{ name: "GitHub", description: "Repos and issues." }], plugins),
    ).toEqual([{ name: "GitHub", description: "Repos and issues.", pluginId: "github" }]);
  });

  test("an empty list stays empty", () => {
    expect(matchIntegrations([], plugins)).toEqual([]);
  });

  test("matches the plugin id or name, ignoring case and punctuation", () => {
    expect(match("github")).toBe("github");
    expect(match("GITHUB")).toBe("github");
    expect(match("Chrome DevTools")).toBe("chrome-devtools");
    expect(match("chrome-devtools")).toBe("chrome-devtools");
    expect(match("Home Assistant")).toBe("homeassistant");
    expect(match("home_assistant")).toBe("homeassistant");
  });

  test.each([
    ["Google Calendar", "google"],
    ["Gmail", "google"],
    ["Google Drive", "google"],
    ["Google Docs", "google"],
    ["Google Sheets", "google"],
    ["Google Workspace", "google"],
    ["1Password", "onepassword"],
    ["One Password", "onepassword"],
  ])("alias: %s goes to %s", (name, id) => {
    expect(match(name)).toBe(id);
  });

  test("a name that starts with a plugin's name is that plugin", () => {
    expect(match("GitHub Issues")).toBe("github");
    expect(match("Linear Roadmap")).toBe("linear");
    expect(match("Notion Databases")).toBe("notion");
  });

  test("a plugin name in the middle or end of another name is not a match", () => {
    expect(match("Not Linear At All")).toBeNull();
    expect(match("My Notion")).toBeNull();
  });

  test("a word that only begins like a plugin name is not a match", () => {
    expect(match("Linearity")).toBeNull();
    expect(match("Gitlab")).toBeNull();
  });

  test("no Zetta equivalent gives null", () => {
    expect(match("Ramp")).toBeNull();
    expect(match("Figma")).toBeNull();
    expect(match("Plaid")).toBeNull();
    expect(match("acme-tool")).toBeNull();
  });

  test("the generic plugins are never matched by a loose name", () => {
    expect(match("Apps it can use")).toBeNull();
    expect(match("Composio Tools")).toBeNull();
  });

  test("an alias only counts when that plugin exists on this server", () => {
    const withoutGoogle = plugins.filter((p) => p.id !== "google");
    expect(match("Google Calendar", withoutGoogle)).toBeNull();
    expect(match("Gmail", withoutGoogle)).toBeNull();
  });

  test("an empty or symbol-only name matches nothing", () => {
    expect(match("")).toBeNull();
    expect(match("***")).toBeNull();
  });

  test("keeps the order and the length of the input", () => {
    const result = matchIntegrations(
      [
        { name: "Ramp", description: "" },
        { name: "GitHub", description: "" },
        { name: "Gmail", description: "" },
      ],
      plugins,
    );
    expect(result.map((r) => [r.name, r.pluginId])).toEqual([
      ["Ramp", null],
      ["GitHub", "github"],
      ["Gmail", "google"],
    ]);
  });
});

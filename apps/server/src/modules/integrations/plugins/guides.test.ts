import { describe, expect, test } from "bun:test";
import "./catalog";
import "./google";
import { CATALOG } from "./catalog";
import { getPlugin, pluginMeta } from "./registry";

describe("plugin setup guides", () => {
  test("the Google guide names the redirect URI the user must register", () => {
    const steps = getPlugin("google")?.guide?.() ?? [];
    expect(steps.some((s) => s.includes("/api/plugins/google/callback"))).toBe(true);
  });

  test("the GitHub guide sends the token to the card, not the chat", () => {
    const meta = pluginMeta(CATALOG.find((d) => d.id === "github")!);
    expect(meta.guide.at(-1)).toContain("Do not paste it in the chat.");
  });

  test("a plugin without a guide has an empty list", () => {
    const linear = CATALOG.find((d) => d.id === "linear");
    expect(pluginMeta(linear!).guide).toEqual([]);
  });
});

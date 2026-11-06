import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ARTIFACT_CSS, withDesignSystem } from "./design-system";

const globals = readFileSync(
  new URL("../../../../../packages/ui/src/styles/globals.css", import.meta.url),
  "utf8",
);
// A rule can list several selectors (`:root, [data-theme-preview="light"]`), so find it by any selector in its list.
const css = globals.replace(/\/\*[\s\S]*?\*\//g, "");
const block = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, list]) =>
    list!
      .split(";")
      .at(-1)!
      .split(",")
      .some((s) => s.trim() === selector),
  )![2]!;
const tokens = (css: string) =>
  [...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, k, v]) => `${k}:${v!.trim()}`);

describe("artifact design system", () => {
  test("uses the app's light and dark color tokens", () => {
    const light = tokens(block(":root"));
    const dark = tokens(block(".dark"));
    const own = tokens(ARTIFACT_CSS);
    const wanted = [
      "background",
      "foreground",
      "card",
      "primary",
      "muted",
      "border",
      "destructive",
    ];
    for (const t of [...light, ...dark].filter((t) => wanted.some((w) => t.startsWith(`--${w}:`))))
      expect(own).toContain(t);
  });
  test("injects the stylesheet right after <head>, or in front of a bare fragment", () => {
    expect(withDesignSystem("<html><head><title>x</title></head></html>")).toStartWith(
      '<html><head><style id="zetta-design">',
    );
    expect(withDesignSystem("<h1>Hi</h1>")).toStartWith('<style id="zetta-design">');
  });
});

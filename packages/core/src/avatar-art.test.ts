import { describe, expect, test } from "bun:test";

import fixtures from "./avatar-art.fixtures.json";
import {
  AVATAR_ART_VERSION,
  AVATAR_CHARACTERS,
  AVATAR_SHAPES,
  parseColorQuery,
  presetAvatarUrl,
  presetColors,
  presetInner,
  renderPresetSvg,
} from "./avatar-art";

/**
 * The fixtures are what the React avatar (`BotAvatar`) drew for each preset before it became a URL: the markup inside the
 * `<svg>`, with React's generated gradient id renamed to `g`. The served file must draw exactly the same thing.
 */
const expected = fixtures as Record<string, { colors: string[]; svg: string }[]>;

describe("preset art matches what the web drew before", () => {
  for (const id of [...AVATAR_SHAPES, ...AVATAR_CHARACTERS].map((p) => p.id)) {
    test(id, () => {
      expect(expected[id]!.length).toBeGreaterThanOrEqual(3);
      for (const { colors, svg } of expected[id]!) expect(presetInner(id, colors)).toBe(svg);
    });
  }
});

describe("served file", () => {
  test("is a standalone 64x64 svg", () => {
    const svg = renderPresetSvg("circle", ["#4a80e6"])!;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"')).toBe(
      true,
    );
    expect(svg.endsWith("</svg>")).toBe(true);
  });
  test("has no script, event handler or external reference", () => {
    for (const p of [...AVATAR_SHAPES, ...AVATAR_CHARACTERS]) {
      const svg = renderPresetSvg(p.id, [])!;
      expect(svg).not.toMatch(/<script|\son\w+=|href=|<foreignObject|javascript:/i);
    }
  });
  test("an unknown preset has no art", () => {
    expect(renderPresetSvg("nope", [])).toBeNull();
    expect(presetAvatarUrl("nope", [])).toBeNull();
  });
  test("a bad color falls back to the preset's own", () => {
    expect(presetInner("robot", ["red", "#12", "<script>"])).toBe(presetInner("robot", []));
    expect(presetColors("circle", ["nonsense"])).toEqual(["#46a05f"]);
  });
});

describe("preset url", () => {
  test("is canonical: lowercase, every slot filled, versioned", () => {
    expect(presetAvatarUrl("circle", ["#4A80E6"])).toBe(
      `/api/avatars/preset/circle.svg?c=4a80e6&v=${AVATAR_ART_VERSION}`,
    );
    expect(presetAvatarUrl("robot", ["#0F172A"])).toBe(
      `/api/avatars/preset/robot.svg?c=0f172a-94a3b8-22d3ee&v=${AVATAR_ART_VERSION}`,
    );
  });
  test("a shape ignores colors past the first, so those bots share one cached file", () => {
    expect(presetAvatarUrl("star", ["#4a80e6", "#ffffff"])).toBe(
      presetAvatarUrl("star", ["#4a80e6"]),
    );
  });
  test("its color query round-trips", () => {
    const url = presetAvatarUrl("cat", ["#c7d2fe", "#f59e0b", "#fef3c7"])!;
    const q = new URL(url, "http://x").searchParams.get("c")!;
    expect(parseColorQuery(q)).toEqual(["#c7d2fe", "#f59e0b", "#fef3c7"]);
  });
  test("a bad color query is rejected", () => {
    for (const q of [
      undefined,
      "",
      "xyz",
      "12345",
      "#aabbcc",
      "AABBCC",
      "aabbcc-",
      "aabbcc-aabbcc-aabbcc-aabbcc-aabbcc",
    ])
      expect(parseColorQuery(q)).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { AVATAR_IMAGE_MAX, isAvatarValue, parseAvatar, type AvatarValue } from "./avatar";

const preset = {
  kind: "preset",
  preset: "blob",
  colors: ["#336699", "#ffcc00"],
} satisfies AvatarValue;
const image = { kind: "image", src: "data:image/webp;base64,UklGRg==" } satisfies AvatarValue;

describe("parseAvatar", () => {
  test("keeps a valid preset", () => {
    expect(parseAvatar(preset)).toEqual(preset);
  });
  test("keeps a valid image", () => {
    expect(parseAvatar(image)).toEqual(image);
  });
  test("a missing value is null", () => {
    expect(parseAvatar(null)).toBeNull();
    expect(parseAvatar(undefined)).toBeNull();
  });
  test("a string, an array or a number is null", () => {
    expect(parseAvatar("https://example.invalid/a.png")).toBeNull();
    expect(parseAvatar([])).toBeNull();
    expect(parseAvatar(7)).toBeNull();
  });
});

describe("isAvatarValue", () => {
  test("refuses an extra key", () => {
    expect(isAvatarValue({ ...preset, extra: 1 })).toBe(false);
    expect(isAvatarValue({ ...image, extra: 1 })).toBe(false);
  });
  test("refuses a preset id with capitals", () => {
    expect(isAvatarValue({ ...preset, preset: "Bad" })).toBe(false);
  });
  test("refuses a short color", () => {
    expect(isAvatarValue({ ...preset, colors: ["#fff"] })).toBe(false);
  });
  test("needs 1 to 4 colors", () => {
    expect(isAvatarValue({ ...preset, colors: [] })).toBe(false);
    expect(isAvatarValue({ ...preset, colors: Array(5).fill("#336699") })).toBe(false);
    expect(isAvatarValue({ ...preset, colors: Array(4).fill("#336699") })).toBe(true);
  });
  test("refuses an SVG image", () => {
    expect(isAvatarValue({ kind: "image", src: "data:image/svg+xml;base64,AA==" })).toBe(false);
  });
  test("refuses an image over the limit and keeps one at the limit", () => {
    const head = "data:image/png;base64,";
    expect(
      isAvatarValue({ kind: "image", src: head + "A".repeat(AVATAR_IMAGE_MAX - head.length) }),
    ).toBe(true);
    expect(
      isAvatarValue({ kind: "image", src: head + "A".repeat(AVATAR_IMAGE_MAX - head.length + 1) }),
    ).toBe(false);
  });
  test("refuses an unknown kind", () => {
    expect(isAvatarValue({ kind: "url", src: "https://example.invalid/a.png" })).toBe(false);
  });
});

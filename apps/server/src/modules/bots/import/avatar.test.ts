import { describe, expect, test } from "bun:test";
import { isAvatarValue } from "@zetta/core/avatar";
import { AVATAR_HOST, presetFor, resolveAvatar, type AvatarFetch } from "./avatar";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50, 1, 2]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const HTML = new TextEncoder().encode("<!doctype html><html></html>");

const bot = (over: Record<string, unknown> = {}) => ({
  id: "example-bot",
  color: "red",
  shape: "teardrop",
  imageUrl: `https://${AVATAR_HOST}/img/creators/example.png`,
  ...over,
});
const serving =
  (bytes: Uint8Array | null): AvatarFetch =>
  async () =>
    bytes ? { bytes } : null;

describe("resolveAvatar: the creator's picture", () => {
  test.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["WebP", WEBP, "image/webp"],
  ])("keeps a %s as a data URL", async (_n, bytes, mime) => {
    const avatar = await resolveAvatar(bot(), { fetch: serving(bytes) });
    expect(avatar.kind).toBe("image");
    if (avatar.kind === "image") {
      expect(avatar.src.startsWith(`data:${mime};base64,`)).toBe(true);
      expect(Buffer.from(avatar.src.split(",")[1]!, "base64").equals(Buffer.from(bytes))).toBe(
        true,
      );
    }
    expect(isAvatarValue(avatar)).toBe(true);
  });

  test("the type comes from the bytes, not from what the URL says", async () => {
    const avatar = await resolveAvatar(bot({ imageUrl: `https://${AVATAR_HOST}/img/x.png` }), {
      fetch: serving(JPEG),
    });
    expect(avatar.kind === "image" && avatar.src.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  test("an SVG is never kept, even one served as an image (it can carry a script)", async () => {
    const avatar = await resolveAvatar(bot({ imageUrl: `https://${AVATAR_HOST}/img/x.svg` }), {
      fetch: serving(SVG),
    });
    expect(avatar.kind).toBe("preset");
  });

  test("an HTML page behind the image URL falls back to a preset", async () => {
    expect((await resolveAvatar(bot(), { fetch: serving(HTML) })).kind).toBe("preset");
  });

  test("an image too large for an avatar falls back to a preset", async () => {
    const big = new Uint8Array(300_000);
    big.set(PNG);
    expect((await resolveAvatar(bot(), { fetch: serving(big) })).kind).toBe("preset");
  });

  test("an image right at the limit is kept, and the result is still a valid avatar", async () => {
    const edge = new Uint8Array(200_000);
    edge.set(PNG);
    const avatar = await resolveAvatar(bot(), { fetch: serving(edge) });
    expect(avatar.kind).toBe("image");
    expect(isAvatarValue(avatar)).toBe(true);
  });

  test("a failed download falls back to a preset", async () => {
    expect((await resolveAvatar(bot(), { fetch: serving(null) })).kind).toBe("preset");
  });

  test("a fetch that throws falls back to a preset, never breaks the import", async () => {
    const avatar = await resolveAvatar(bot(), {
      fetch: async () => {
        throw new Error("boom");
      },
    });
    expect(avatar.kind).toBe("preset");
  });

  test("an empty body falls back to a preset", async () => {
    expect((await resolveAvatar(bot(), { fetch: serving(new Uint8Array(0)) })).kind).toBe("preset");
  });
});

describe("resolveAvatar: which addresses are fetched", () => {
  test.each([
    ["another host", "https://evil.example.invalid/a.png"],
    ["a look-alike host", `https://${AVATAR_HOST}.evil.example.invalid/a.png`],
    ["user info in front of the host", `https://${AVATAR_HOST}@evil.example.invalid/a.png`],
    ["http", `http://${AVATAR_HOST}/a.png`],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["a private address", "https://127.0.0.1/a.png"],
    ["not a URL", "not a url"],
  ])("%s is never requested", async (_n, imageUrl) => {
    let called = false;
    const avatar = await resolveAvatar(bot({ imageUrl }), {
      fetch: async () => {
        called = true;
        return { bytes: PNG };
      },
    });
    expect(called).toBe(false);
    expect(avatar.kind).toBe("preset");
  });

  test("no image means no request", async () => {
    let called = false;
    const avatar = await resolveAvatar(bot({ imageUrl: null }), {
      fetch: async () => {
        called = true;
        return { bytes: PNG };
      },
    });
    expect(called).toBe(false);
    expect(avatar.kind).toBe("preset");
  });
});

describe("presetFor: the fallback picture", () => {
  test("is always a valid avatar", () => {
    for (const shape of ["teardrop", "circle", "nonsense", "", "BLOB"])
      for (const color of ["red", "blue", "", "not-a-color", "#fff"])
        expect(isAvatarValue(presetFor({ id: "x", color, shape }))).toBe(true);
  });

  test("maps the marketplace's names to ours", () => {
    expect(presetFor({ id: "x", color: "red", shape: "teardrop" })).toMatchObject({
      kind: "preset",
      preset: "drop",
    });
    expect(presetFor({ id: "x", color: "red", shape: "circle" })).toMatchObject({
      preset: "circle",
    });
  });

  test("an unknown shape becomes a blob", () => {
    expect(presetFor({ id: "x", color: "red", shape: "squiggle" })).toMatchObject({
      preset: "blob",
    });
  });

  test("a known color name gives that color", () => {
    const red = presetFor({ id: "x", color: "red", shape: "circle" });
    const blue = presetFor({ id: "x", color: "blue", shape: "circle" });
    expect(red.colors[0]).not.toBe(blue.colors[0]);
    expect(presetFor({ id: "y", color: "Red", shape: "circle" }).colors).toEqual(red.colors);
  });

  test("an unknown color is picked from the id, the same every time", () => {
    const a1 = presetFor({ id: "alpha", color: "", shape: "circle" });
    const a2 = presetFor({ id: "alpha", color: "", shape: "circle" });
    expect(a1).toEqual(a2);
    const spread = new Set(
      ["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "ggggggg"].map(
        (id) => presetFor({ id, color: "", shape: "circle" }).colors[0],
      ),
    );
    expect(spread.size).toBeGreaterThan(1);
  });
});

/** A picture for a bot or a person: a preset shape with colors, or a small uploaded image kept as a data URL. */
export type AvatarValue =
  | { kind: "preset"; preset: string; colors: string[] }
  | { kind: "image"; src: string };

/** The longest image data URL we keep. The web picker crops to 128x128 WebP, far below this. */
export const AVATAR_IMAGE_MAX = 300_000;

const PRESET = /^[a-z0-9-]{1,32}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** Strict check for input from a client: unknown keys, an SVG, a bad color or an oversized image all fail. */
export function isAvatarValue(v: unknown): v is AvatarValue {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const a = v as Record<string, unknown>;
  const keys = Object.keys(a).sort().join();
  if (a.kind === "preset")
    return (
      keys === "colors,kind,preset" &&
      typeof a.preset === "string" &&
      PRESET.test(a.preset) &&
      Array.isArray(a.colors) &&
      a.colors.length >= 1 &&
      a.colors.length <= 4 &&
      a.colors.every((c) => typeof c === "string" && COLOR.test(c))
    );
  if (a.kind === "image")
    return (
      keys === "kind,src" &&
      typeof a.src === "string" &&
      a.src.length <= AVATAR_IMAGE_MAX &&
      IMAGE.test(a.src)
    );
  return false;
}

/** The stored value, or `null` when it is missing or not a valid avatar (the UI then shows an initial). */
export const parseAvatar = (v: unknown): AvatarValue | null => (isAvatarValue(v) ? v : null);

/**
 * A picture for a bot or a person: a preset shape with colors, or a small uploaded image.
 *
 * What is stored is always a data URL. What the server sends is lighter: an image is a link to `/api/avatars/{bot|user}/<id>?v=<hash>`
 * (see `avatarRef`), so a list of bots does not carry up to 300 KB of base64 for each picture, and the browser caches the file.
 */
export type AvatarValue =
  | { kind: "preset"; preset: string; colors: string[] }
  | { kind: "image"; src: string };

/** The longest image data URL we keep. The web picker crops to 128x128 WebP, far below this. */
export const AVATAR_IMAGE_MAX = 300_000;

const PRESET = /^[a-z0-9-]{1,32}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
/** The link the server sends in place of an uploaded image: whose picture it is, and a hash of it so a new picture is a new URL. */
export const AVATAR_REF =
  /^\/api\/avatars\/(bot|user)\/([A-Za-z0-9_-]{1,64})(?:\?v=[a-z0-9]{1,16})?$/;

export type AvatarOwner = "bot" | "user";
/** The picture an image link points at, or null when `src` is not one of our links (a data URL, a foreign URL). */
export function parseAvatarRef(src: string): { owner: AvatarOwner; id: string } | null {
  const m = AVATAR_REF.exec(src);
  return m ? { owner: m[1] as AvatarOwner, id: m[2]! } : null;
}

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

/** What a client may send or receive: a stored value, or an image given as one of our links (`parseAvatarRef`). */
export function isAvatarWire(v: unknown): v is AvatarValue {
  if (isAvatarValue(v)) return true;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const a = v as Record<string, unknown>;
  return (
    a.kind === "image" &&
    Object.keys(a).sort().join() === "kind,src" &&
    typeof a.src === "string" &&
    AVATAR_REF.test(a.src)
  );
}

/** The value as sent or stored, or `null` when it is missing or not a valid avatar (the UI then shows an initial). */
export const parseAvatar = (v: unknown): AvatarValue | null => (isAvatarWire(v) ? v : null);

import { AVATAR_IMAGE_MAX, isAvatarValue, type AvatarValue } from "@zetta/core/avatar";

import { assertPublicUrl } from "../../computer/service";

/**
 * The picture of an imported bot: the creator's image when we can keep it safely, else a preset in the bot's own color.
 *
 * A bot's avatar is stored in the bot row, so it can only be a small data URL (png, jpeg or webp), never a link: a link would be
 * fetched by every browser that shows the bot. The download is therefore limited to the marketplace's own asset host, and what comes
 * back is trusted only by its leading bytes. Nothing here may stop an import: any problem means "use a preset".
 */
export const AVATAR_HOST = "grok-bot-marketplace-public-assets.s3.amazonaws.com";
const DOWNLOAD_MAX = 400_000;
const TIMEOUT_MS = 8_000;

export type AvatarFetch = (url: string) => Promise<{ bytes: Uint8Array } | null>;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
/** The image type from its first bytes. SVG, HTML and everything else is null: an SVG can carry a script. */
function sniff(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

const defaultFetch: AvatarFetch = async (url) => {
  try {
    await assertPublicUrl(url);
    // No redirects: the asset host answers directly, and a redirect could lead somewhere we did not check.
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "image/png,image/jpeg,image/webp", "user-agent": "Zetta bot import" },
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DOWNLOAD_MAX) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks) };
  } catch {
    return null;
  }
};

/** Names the marketplace gives its colors, as the soft mid-tones the built-in avatars use. */
const COLORS: Record<string, string> = {
  red: "#d4504c",
  orange: "#dc8a42",
  yellow: "#cfa843",
  green: "#4aa36b",
  teal: "#4aa396",
  blue: "#4a80e6",
  indigo: "#5b5fd6",
  purple: "#7e5cc4",
  pink: "#d65c9a",
  gray: "#7b8794",
  grey: "#7b8794",
  brown: "#9a6b4a",
};
const PALETTE = [
  "#4a80e6",
  "#4aa396",
  "#7e5cc4",
  "#dc8a42",
  "#cfa843",
  "#d4504c",
  "#d65c9a",
  "#4aa36b",
];
/** The marketplace's shape names that differ from ours; the rest are used as they are when we draw them, else a blob. */
const SHAPES: Record<string, string> = { teardrop: "drop" };
const DRAWN = new Set([
  "arrow",
  "blob",
  "circle",
  "square",
  "pill",
  "drop",
  "bell",
  "hexagon",
  "diamond",
  "star",
  "triangle",
  "pentagon",
  "octagon",
  "cross",
  "arch",
  "parallelogram",
  "kite",
  "burst",
]);

/** A stable pick from the palette for a bot whose color we do not know, so the same bot always looks the same. */
function colorFromId(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function presetFor(bot: {
  id: string;
  color: string;
  shape: string;
}): Extract<AvatarValue, { kind: "preset" }> {
  const shape = bot.shape.trim().toLowerCase();
  const preset = SHAPES[shape] ?? (DRAWN.has(shape) ? shape : "blob");
  const color = COLORS[bot.color.trim().toLowerCase()] ?? colorFromId(bot.id);
  return { kind: "preset", preset, colors: [color] };
}

/** True only for https://<marketplace asset host>/..., with no credentials. */
function allowed(imageUrl: string): boolean {
  try {
    const u = new URL(imageUrl);
    return (
      u.protocol === "https:" && u.hostname === AVATAR_HOST && !u.username && !u.password && !u.port
    );
  } catch {
    return false;
  }
}

export async function resolveAvatar(
  bot: { id: string; color: string; shape: string; imageUrl: string | null },
  deps: { fetch?: AvatarFetch } = {},
): Promise<AvatarValue> {
  const fallback = presetFor(bot);
  if (!bot.imageUrl || !allowed(bot.imageUrl)) return fallback;
  try {
    const got = await (deps.fetch ?? defaultFetch)(bot.imageUrl);
    if (!got || got.bytes.byteLength === 0) return fallback;
    const type = sniff(got.bytes);
    if (!type) return fallback;
    const avatar: AvatarValue = {
      kind: "image",
      src: `data:${type};base64,${Buffer.from(got.bytes).toString("base64")}`,
    };
    // The stored limit is on the data URL, not on the file: base64 adds a third.
    return avatar.src.length <= AVATAR_IMAGE_MAX && isAvatarValue(avatar) ? avatar : fallback;
  } catch {
    return fallback;
  }
}

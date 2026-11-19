import { parseAvatar, type AvatarOwner, type AvatarValue } from "@zetta/core/avatar";

/** A short fingerprint of a picture: part of its URL, so a new picture is a new URL and the old one can stay cached for a year. */
const version = (src: string) => Bun.hash(src).toString(36).slice(0, 12);

/**
 * The avatar as the API sends it. A preset stays as it is (a few bytes; the browser turns it into a template URL). An uploaded picture,
 * a data URL of up to 300 KB that used to ride in every list of bots and people, becomes a link to `/api/avatars/{bot|user}/<id>`.
 * Anything that is not a valid avatar becomes `null`, as the web already treats it.
 */
export function avatarOut(owner: AvatarOwner, id: string, avatar: unknown): AvatarValue | null {
  const a = parseAvatar(avatar);
  if (!a || a.kind !== "image") return a;
  // Already a link (a value that went through here once): leave it.
  if (a.src.startsWith("/api/")) return a;
  return { kind: "image", src: `/api/avatars/${owner}/${id}?v=${version(a.src)}` };
}

/** The decoded bytes and type of an uploaded picture stored as a data URL, or null when the value is not one. */
export function decodeImage(avatar: unknown): { bytes: Uint8Array; mime: string } | null {
  const a = parseAvatar(avatar);
  if (!a || a.kind !== "image") return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(a.src);
  return m ? { mime: m[1]!, bytes: Buffer.from(m[2]!, "base64") } : null;
}

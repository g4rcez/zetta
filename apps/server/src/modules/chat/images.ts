import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
const EXT: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const isImageType = (mime: string): mime is ImageType =>
  (IMAGE_TYPES as readonly string[]).includes(mime);

/** Where uploaded images live. They are kept forever so chats can be restored with their pictures. */
export const attachmentsRoot = () =>
  process.env.ZETTA_ATTACHMENTS_ROOT || join(homedir(), ".zetta", "attachments");

/** The type the bytes really are (by magic number), or undefined when they are not a supported image. */
export function sniffImage(b: Uint8Array): ImageType | undefined {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length > 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length > 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length > 6 && at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39))
    return "image/gif";
  if (b.length > 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
    return "image/webp";
  return undefined;
}

const safeUser = (userId: string) => userId.replace(/[^A-Za-z0-9_-]/g, "_");

/** Absolute path of a stored image; refuses anything that would leave the root. */
export function imagePath(rel: string, root = attachmentsRoot()) {
  const base = resolve(root);
  const abs = resolve(base, rel);
  if (!abs.startsWith(base + sep)) throw new Error("PATH_OUTSIDE_ROOT");
  return abs;
}

/** Writes the bytes once (content-addressed, so the same picture is stored a single time) and returns the relative path. */
export async function saveImage(
  userId: string,
  bytes: Uint8Array,
  type: ImageType,
  root = attachmentsRoot(),
) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const rel = join(safeUser(userId), `${sha256}.${EXT[type]}`);
  const abs = imagePath(rel, root);
  if (!(await Bun.file(abs).exists())) {
    await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
    await chmod(dirname(abs), 0o700).catch(() => {});
    await writeFile(abs, bytes, { mode: 0o600 });
  }
  return { rel, sha256 };
}

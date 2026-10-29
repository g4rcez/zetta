import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ARTIFACT_KINDS, type ArtifactKind } from "@zetta/db/schema/artifacts";

export class ArtifactFileError extends Error {
  constructor(readonly code: "NOT_FOUND" | "TOO_LARGE" | "INVALID" | "QUOTA") {
    super(code);
  }
}

export const MAX_ARTIFACT_BYTES = 500 * 1024 * 1024;
/** Total bytes one user may keep (`ZETTA_ARTIFACTS_QUOTA`, default 5 GB). Nothing is deleted to make room: a publish over it is refused. */
export const artifactsQuota = () => Number(process.env.ZETTA_ARTIFACTS_QUOTA) || 5 * 1024 ** 3;
/** Inline `content` travels in a chat reply, so it stays small. */
export const MAX_INLINE_BYTES = 256 * 1024;

/** Where artifacts live. Kept forever, like chat images. */
export const artifactsRoot = () =>
  process.env.ZETTA_ARTIFACTS_ROOT || join(homedir(), ".zetta", "artifacts");

const safeUser = (userId: string) => userId.replace(/[^A-Za-z0-9_-]/g, "_");
/** Absolute path of a stored artifact. Content-addressed per user: the same bytes are stored once. */
export const artifactPath = (userId: string, sha256: string, root = artifactsRoot()) =>
  join(root, safeUser(userId), sha256);

const CODE = new Set(
  "ts tsx js jsx mjs cjs py rb go rs java kt c h cc cpp hpp cs php sh bash zsh sql css scss xml yaml yml toml ini diff patch".split(
    " ",
  ),
);
const BY_EXT: Record<string, ArtifactKind> = {
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  log: "text",
  csv: "csv",
  tsv: "csv",
  json: "json",
  pdf: "pdf",
  zip: "zip",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
};
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** The mime type (the bot's, when it is well formed; else guessed from the extension) and the kind the preview page draws. */
export function classify(fileName: string, declared?: string) {
  const ext = extname(fileName).slice(1).toLowerCase();
  const clean = declared?.split(";")[0]?.trim().toLowerCase();
  const mimeType =
    clean && MIME.test(clean)
      ? clean
      : Bun.file(fileName).type.split(";")[0] || "application/octet-stream";
  const fromMime: ArtifactKind | undefined = mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("video/")
      ? "video"
      : mimeType.startsWith("audio/")
        ? "audio"
        : mimeType === "text/html"
          ? "html"
          : mimeType === "text/markdown"
            ? "markdown"
            : mimeType === "text/csv"
              ? "csv"
              : mimeType === "application/json"
                ? "json"
                : mimeType === "application/pdf"
                  ? "pdf"
                  : mimeType === "application/zip"
                    ? "zip"
                    : undefined;
  const kind: ArtifactKind =
    fromMime ??
    BY_EXT[ext] ??
    (CODE.has(ext) ? "code" : mimeType.startsWith("text/") ? "text" : "binary");
  return { mimeType, kind };
}
export const isArtifactKind = (v: string): v is ArtifactKind =>
  (ARTIFACT_KINDS as readonly string[]).includes(v);

async function place(
  userId: string,
  sha256: string,
  root: string,
  write: (tmp: string) => Promise<void>,
) {
  const abs = artifactPath(userId, sha256, root);
  if (await Bun.file(abs).exists()) return;
  await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
  await chmod(dirname(abs), 0o700).catch(() => {});
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  try {
    await write(tmp);
    await rename(tmp, abs);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Saves text the bot sent in its reply (for bots with no code workspace). */
export async function saveContent(userId: string, text: string, root = artifactsRoot()) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length === 0) throw new ArtifactFileError("INVALID");
  if (bytes.length > MAX_INLINE_BYTES) throw new ArtifactFileError("TOO_LARGE");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await place(userId, sha256, root, (tmp) => writeFile(tmp, bytes, { mode: 0o600 }));
  return { sha256, size: bytes.length };
}

/**
 * Copies a file from the user's code workspace into the artifact store. The path goes through realpath and must stay inside
 * the workspace, so `..` and symlinks cannot reach other files. The bytes are hashed while they are copied, with a hard size cap.
 */
export async function savePath(
  userId: string,
  rel: string,
  workspace: string,
  root = artifactsRoot(),
) {
  // oxlint-disable-next-line no-control-regex -- rejects control characters on purpose
  if (!rel || /[\u0000-\u001f]/.test(rel)) throw new ArtifactFileError("INVALID");
  let base: string;
  let target: string;
  try {
    base = await realpath(workspace);
    target = await realpath(resolve(base, rel));
  } catch {
    throw new ArtifactFileError("NOT_FOUND");
  }
  if (!target.startsWith(base + sep)) throw new ArtifactFileError("NOT_FOUND");
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => {
    throw new ArtifactFileError("NOT_FOUND");
  });
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new ArtifactFileError("NOT_FOUND");
    if (info.size > MAX_ARTIFACT_BYTES) throw new ArtifactFileError("TOO_LARGE");
    if (info.size === 0) throw new ArtifactFileError("INVALID");
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        if (size > MAX_ARTIFACT_BYTES) return done(new ArtifactFileError("TOO_LARGE"));
        hash.update(chunk);
        done(null, chunk);
      },
    });
    // The bytes go to a temp file first: the final name is the hash, which is only known after the copy.
    const tmp = join(root, safeUser(userId), `.in-${process.pid}-${Date.now()}.tmp`);
    await mkdir(dirname(tmp), { recursive: true, mode: 0o700 });
    await chmod(dirname(tmp), 0o700).catch(() => {});
    try {
      await pipeline(
        createReadStream("", { fd: handle.fd, autoClose: false }),
        meter,
        createWriteStream(tmp, { mode: 0o600 }),
      );
      const sha256 = hash.digest("hex");
      const abs = artifactPath(userId, sha256, root);
      if (await Bun.file(abs).exists()) await rm(tmp, { force: true });
      else await rename(tmp, abs);
      return { sha256, size, fileName: target.slice(target.lastIndexOf(sep) + 1) };
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  } finally {
    await handle.close();
  }
}

import { uuidv7 } from "@zetta/core/uuid";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Reading and writing in a folder that someone else may be changing at the same time: a container that has it mounted, or a bot
 * with a shell in it. A link they plant must never lead the server to a file outside it.
 *
 * `root` is a folder only the server can replace (a mount root, a user's code folder). Under it **no link is followed**, at any
 * level: the file that was opened must be found again, by its own path, with the same inode.
 */
export class LinkError extends Error {
  constructor() {
    super("The path leads outside its folder.");
  }
}

// Windows has neither flag. NONBLOCK keeps a planted pipe from holding the open forever.
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const CHUNK = 1 << 20;

const escapes = (rel: string) =>
  !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

/** The real root and the path under it. `path` is relative to the root, or an absolute path inside it under either of its names. */
async function under(root: string, path: string) {
  const base = await realpath(root);
  let rel = relative(resolve(root), resolve(root, path));
  if (escapes(rel)) rel = relative(base, resolve(base, path));
  if (escapes(rel)) throw new LinkError();
  return { base, rel, target: join(base, rel) };
}

/** The information of `handle` when it is the regular file at `target` and no link led to it. */
async function itself(handle: FileHandle, target: string) {
  const info = await handle.stat();
  if (!info.isFile()) return undefined;
  if ((await realpath(target).catch(() => undefined)) !== target) return undefined;
  const now = await stat(target).catch(() => undefined);
  return now && now.ino === info.ino && now.dev === info.dev ? info : undefined;
}

/** A regular file under `root`, open for reading, or undefined (missing, a link, a link on the way, or not a file). Close it. */
export async function openInside(root: string, path: string) {
  let handle: FileHandle | undefined;
  try {
    const { target } = await under(root, path);
    handle = await open(target, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
    const info = await itself(handle, target);
    if (info) return { handle, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    // Answered below.
  }
  await handle?.close();
  return undefined;
}

/** The bytes of a file under `root`, or undefined (see `openInside`, or larger than `max`). */
export async function readInside(root: string, path: string, max: number) {
  const opened = await openInside(root, path);
  if (!opened) return undefined;
  try {
    if (opened.size > max) return undefined;
    const bytes = Buffer.alloc(opened.size);
    let at = 0;
    while (at < bytes.length) {
      const { bytesRead } = await opened.handle.read(bytes, at, bytes.length - at, at);
      if (!bytesRead) break;
      at += bytesRead;
    }
    return bytes.subarray(0, at);
  } finally {
    await opened.handle.close();
  }
}

/** Creates the folders of `path` one by one. A link at any level is refused. */
async function folders(base: string, path: string) {
  let at = base;
  for (const part of path.split(sep)) {
    if (!part || part === ".") continue;
    at = join(at, part);
    await mkdir(at, { mode: 0o700 }).catch((e: unknown) => {
      if ((e as { code?: string }).code !== "EEXIST") throw e;
    });
    if (!(await lstat(at)).isDirectory()) throw new LinkError();
  }
  return at;
}

/** Makes a folder under `root` (and the root), with no link on the way. */
export async function folderInside(root: string, path: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const { base, rel } = await under(root, path);
  return folders(base, rel);
}

/**
 * Writes a file under `root`, making the folders above it. The bytes go to a new file beside it, which then takes the name: a file or
 * a link already there is replaced, never written through. `data` may be an open file, whose bytes are copied.
 */
export async function writeInside(
  root: string,
  path: string,
  data: string | Uint8Array | FileHandle,
  mode = 0o600,
) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const { base, rel, target } = await under(root, path);
  const parent = await folders(base, dirname(rel));
  const temp = join(parent, `.${basename(rel).slice(0, 60)}.${uuidv7().slice(-12)}.part`);
  const handle = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
    mode,
  );
  try {
    // Checked before a byte is written: a folder swapped for a link since `folders` would have put the new file elsewhere.
    if (!(await itself(handle, temp))) throw new LinkError();
    if (typeof data === "string" || data instanceof Uint8Array) await handle.writeFile(data);
    else {
      const chunk = Buffer.alloc(CHUNK);
      for (let at = 0; ;) {
        const { bytesRead } = await data.read(chunk, 0, chunk.length, at);
        if (!bytesRead) break;
        await handle.write(chunk, 0, bytesRead);
        at += bytesRead;
      }
    }
    await handle.close();
    await rename(temp, target);
  } catch (e) {
    await handle.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw e;
  }
  return target;
}

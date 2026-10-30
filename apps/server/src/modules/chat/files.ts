import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export class FileAccessError extends Error {
  constructor(readonly code: "NOT_FOUND" | "TOO_LARGE" | "NOT_TEXT") {
    super(code);
  }
}
const MAX_BYTES = 256 * 1024;
/** Names that commonly hold credentials are never readable or listed, even inside an allowed area. */
const DENIED =
  /(^|\/)(\.env(\..*)?|\.git|\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.config|\.npmrc|\.netrc|\.pgpass|\.git-credentials|\.htpasswd|credentials(\..*)?|secrets?(\..*)?|id_[a-z0-9]+|.*\.(pem|key|p12|pfx|kdbx|keystore|jks|gpg|asc))($|\/)/i;

/**
 * Authorized server files. Layout under `root`: `me/<userId>/…` (private to that user) and `shared/…` (team readable).
 * Paths are always given as `me/…` or `shared/…`; they are resolved through realpath and must stay inside the allowed area,
 * so `..` and symlinks cannot escape or reach another user's area.
 */
export function createFileStore(root: string) {
  async function area(userId: string, rel: string) {
    // Only forward slashes and plain characters: no backslash tricks (Windows), NUL bytes or control characters.
    // oxlint-disable-next-line no-control-regex
    if (DENIED.test(rel) || /[\\\u0000-\u001f]/.test(rel)) throw new FileAccessError("NOT_FOUND");
    const [head, ...rest] = rel.split("/").filter(Boolean);
    if (head !== "me" && head !== "shared") throw new FileAccessError("NOT_FOUND");
    const base = head === "me" ? join(root, "me", userId) : join(root, "shared");
    let realBase: string;
    try {
      realBase = await realpath(base);
    } catch {
      throw new FileAccessError("NOT_FOUND");
    }
    let target: string;
    try {
      target = await realpath(resolve(realBase, ...rest));
    } catch {
      throw new FileAccessError("NOT_FOUND");
    }
    if (target !== realBase && !target.startsWith(realBase + sep))
      throw new FileAccessError("NOT_FOUND");
    if (DENIED.test(target.slice(realBase.length))) throw new FileAccessError("NOT_FOUND");
    return target;
  }
  return {
    async list(userId: string, rel: string) {
      const dir = await area(userId, rel);
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
        throw new FileAccessError("NOT_FOUND");
      });
      return entries
        .filter((e) => (e.isFile() || e.isDirectory()) && !DENIED.test(e.name))
        .slice(0, 200)
        .map((e) => ({
          name: e.name,
          kind: e.isDirectory() ? ("dir" as const) : ("file" as const),
        }));
    },
    /** Reads text through one file handle (fstat on the opened handle, so the checked file is the read file). Returns the text and its sha256. */
    async read(userId: string, rel: string) {
      return (await this.readWithHash(userId, rel)).text;
    },
    async readWithHash(userId: string, rel: string) {
      const file = await area(userId, rel);
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
        () => {
          throw new FileAccessError("NOT_FOUND");
        },
      );
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new FileAccessError("NOT_FOUND");
        if (info.size > MAX_BYTES) throw new FileAccessError("TOO_LARGE");
        const bytes = await handle.readFile();
        if (bytes.includes(0)) throw new FileAccessError("NOT_TEXT");
        return {
          text: bytes.toString("utf8"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      } finally {
        await handle.close();
      }
    },
  };
}
export type FileStore = ReturnType<typeof createFileStore>;

import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open, rename } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { decodeJournal, encodeJournal, JOURNAL_BYTE_LIMIT } from "./journal-codec";
import type { JournalTrust } from "./journal-codec";
import { createFixtureLaunchPolicy } from "./launch-recipe";
import type { LaunchJournal } from "./launch-journal";

export type JournalFileStage =
  | "validate"
  | "create"
  | "write"
  | "file_sync"
  | "file_close"
  | "rename"
  | "directory_sync"
  | "readback";
type Code =
  | "inventory_busy"
  | "journal_invalid_files"
  | "journal_recovery_required"
  | "journal_conflict"
  | "journal_durability_unknown"
  | "journal_closed";
export class JournalFileError extends Error {
  readonly name = "JournalFileError";
  constructor(
    readonly code: Code,
    readonly stage: JournalFileStage = "validate",
  ) {
    super(code);
  }
}
// Trusted construction-only syscall seams; never parse these from a request/config file.
export type JournalFileFaults = Readonly<{
  before?: (stage: JournalFileStage) => Promise<void>;
  after?: (stage: JournalFileStage) => Promise<void>;
  write?: (handle: FileHandle, bytes: Buffer, offset: number) => Promise<number>;
}>;
type Options = JournalTrust & Readonly<{ root: string; uid: number }>;
type Verified = Readonly<{ path: string; handle: FileHandle; stat: Stats }>;
const invalid = () => new JournalFileError("journal_invalid_files");
const identity = (a: Stats, b: Stats) =>
  a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
const unchanged = (a: Stats, b: Stats) =>
  identity(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function valid(stat: Stats, uid: number, directory: boolean): boolean {
  return (
    stat.uid === uid &&
    (stat.mode & 0o7777) === (directory ? 0o700 : 0o600) &&
    (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1)
  );
}
async function ancestors(root: string, uid: number) {
  for (let path = dirname(root); ; path = dirname(path)) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== uid) || (stat.mode & 0o7022) !== 0)
      throw invalid();
    if (path === dirname(path)) return;
  }
}
async function verify(
  file: Verified,
  uid: number,
  directory: boolean,
  stable = false,
  observational = false,
) {
  const current = await file.handle.stat();
  let named: Stats;
  try {
    named = await lstat(file.path);
  } catch {
    if (observational) throw new JournalFileError("inventory_busy");
    throw invalid();
  }
  if (
    observational &&
    (!identity(file.stat, current) ||
      !identity(current, named) ||
      !unchanged(file.stat, current) ||
      !unchanged(current, named))
  )
    throw new JournalFileError("inventory_busy");
  if (
    !valid(current, uid, directory) ||
    !identity(file.stat, current) ||
    !identity(current, named) ||
    (stable && (!unchanged(file.stat, current) || !unchanged(current, named)))
  )
    throw invalid();
}
async function verifiedOpen(
  path: string,
  uid: number,
  directory: boolean,
  observational = false,
): Promise<Verified> {
  const handle = await open(
    path,
    constants.O_RDONLY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK |
      (directory ? constants.O_DIRECTORY : 0),
  );
  try {
    const file = { path, handle, stat: await handle.stat() };
    await verify(file, uid, directory, false, observational);
    return file;
  } catch (error) {
    await handle.close();
    if (observational && error instanceof JournalFileError) throw error;
    throw invalid();
  }
}
async function absent(path: string) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
    throw error;
  }
}

// INTERNAL: caller holds exclusive receipt lock (and installation lock for insertion).
// Root/receipt and their namespace sync already exist. No locking, allocation, inventory,
// timeout, effect authority or Linux readiness is provided by these file primitives.
async function openJournalAccess(
  options: Options,
  suppliedFaults: JournalFileFaults = {},
  observational = false,
) {
  const { root, uid, receiptId } = options;
  const faults = Object.freeze({ ...suppliedFaults });
  let rootFile: Verified | undefined, directory: Verified | undefined;
  let trusted: JournalTrust;
  try {
    if (
      !isAbsolute(root) ||
      normalize(root) !== root ||
      !Number.isSafeInteger(uid) ||
      uid < 0 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(receiptId)
    )
      throw invalid();
    trusted = Object.freeze({ receiptId, policy: createFixtureLaunchPolicy(options.policy) });
    await ancestors(root, uid);
    rootFile = await verifiedOpen(root, uid, true);
    directory = await verifiedOpen(join(root, receiptId), uid, true);
    if (directory.stat.dev !== rootFile.stat.dev) throw invalid();
  } catch {
    try {
      await directory?.handle.close();
    }
    // oxlint-disable-next-line no-unsafe-finally
    finally {
      try {
        await rootFile?.handle.close();
      } finally {
        // oxlint-disable-next-line no-unsafe-finally
        throw invalid();
      }
    }
  }
  const heldRoot = rootFile,
    heldDirectory = directory;
  const currentPath = join(heldDirectory.path, "record.json"),
    stagingPath = join(heldDirectory.path, "record.next");
  let closed = false,
    poisoned = false,
    active = false;
  async function protectedPaths() {
    await ancestors(root, uid);
    await verify(heldRoot, uid, true);
    await verify(heldDirectory, uid, true);
  }
  function ready() {
    if (poisoned) throw new JournalFileError("journal_durability_unknown");
    if (closed) throw new JournalFileError("journal_closed");
    if (active) throw new JournalFileError("journal_conflict");
  }
  async function readBytes(): Promise<Buffer> {
    await protectedPaths();
    const file = await verifiedOpen(currentPath, uid, false, observational);
    try {
      if (
        file.stat.dev !== heldDirectory.stat.dev ||
        file.stat.size === 0 ||
        file.stat.size > JOURNAL_BYTE_LIMIT
      )
        throw invalid();
      const bytes = Buffer.alloc(JOURNAL_BYTE_LIMIT + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await file.handle.read(bytes, length, bytes.length - length, length);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (!unchanged(file.stat, await file.handle.stat()))
        throw observational ? new JournalFileError("inventory_busy") : invalid();
      if (length !== file.stat.size || length > JOURNAL_BYTE_LIMIT) throw invalid();
      await verify(file, uid, false, true, observational);
      await protectedPaths();
      const bounded = bytes.subarray(0, length);
      decodeJournal(bounded, trusted);
      return bounded;
    } finally {
      await file.handle.close();
    }
  }
  return Object.freeze({
    async read(): Promise<LaunchJournal> {
      ready();
      active = true;
      try {
        return decodeJournal(await readBytes(), trusted);
      } catch (error) {
        if (observational && error instanceof JournalFileError) throw error;
        throw invalid();
      } finally {
        active = false;
      }
    },
    async commit(expected: LaunchJournal | null, next: unknown): Promise<void> {
      ready();
      active = true;
      let mutated = false,
        stage: JournalFileStage = "validate",
        staging: FileHandle | undefined;
      async function step<T>(name: JournalFileStage, operation: () => Promise<T>): Promise<T> {
        stage = name;
        await faults.before?.(name);
        const result = await operation();
        await faults.after?.(name);
        return result;
      }
      try {
        const bytes = encodeJournal(next, trusted),
          old = expected === null ? null : encodeJournal(expected, trusted);
        await protectedPaths();
        if (!(await absent(stagingPath))) throw new JournalFileError("journal_recovery_required");
        if (old === null ? !(await absent(currentPath)) : !(await readBytes()).equals(old))
          throw new JournalFileError("journal_conflict");
        // Any open/create ambiguity is conservative: retain namespace and poison owner.
        mutated = true;
        await step("create", async () => {
          staging = await open(
            stagingPath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
          );
        });
        if (!staging) throw invalid();
        const file = { path: stagingPath, handle: staging, stat: await staging.stat() };
        await verify(file, uid, false);
        if (file.stat.dev !== heldDirectory.stat.dev) throw invalid();
        await step("write", async () => {
          let offset = 0;
          while (offset < bytes.length) {
            const count = faults.write
              ? await faults.write(file.handle, bytes, offset)
              : (await file.handle.write(bytes, offset, bytes.length - offset, offset))
                  .bytesWritten;
            if (!Number.isInteger(count) || count <= 0 || count > bytes.length - offset)
              throw invalid();
            offset += count;
          }
        });
        await step("file_sync", () => file.handle.sync());
        await verify(file, uid, false);
        await step("file_close", async () => {
          await file.handle.close();
          staging = undefined;
        });
        await protectedPaths();
        const stagedName = await lstat(stagingPath);
        if (!valid(stagedName, uid, false) || !identity(file.stat, stagedName)) throw invalid();
        if (old === null ? !(await absent(currentPath)) : !(await readBytes()).equals(old))
          throw invalid();
        await step("rename", () => rename(stagingPath, currentPath));
        await step("directory_sync", () => heldDirectory.handle.sync());
        await step("readback", async () => {
          if (!(await readBytes()).equals(bytes)) throw invalid();
        });
        await protectedPaths();
      } catch (error) {
        if (mutated) {
          poisoned = true;
          throw new JournalFileError("journal_durability_unknown", stage);
        }
        if (error instanceof JournalFileError) throw error;
        throw invalid();
      } finally {
        try {
          await staging?.close();
        }
        // oxlint-disable-next-line no-unsafe-finally
        catch {
          poisoned = true;
          // oxlint-disable-next-line no-unsafe-finally
          throw new JournalFileError("journal_durability_unknown", stage);
        } finally {
          active = false;
        }
      }
    },
    async close(): Promise<void> {
      if (active) throw new JournalFileError("journal_conflict");
      if (closed) return;
      closed = true;
      try {
        await heldDirectory.handle.close();
      } catch {
        throw invalid();
      }
      // oxlint-disable-next-line no-unsafe-finally
      finally {
        try {
          await heldRoot.handle.close();
        } catch {
          // oxlint-disable-next-line no-unsafe-finally
          throw invalid();
        }
      }
    },
  });
}

// Exclusive receipt ownership is required, plus admission ownership for insertion.
export function openJournalFiles(options: Options, faults: JournalFileFaults = {}) {
  return openJournalAccess(options, faults);
}

// Observational only: no returned handle, commit or effect authority. A live writer may
// replace record.json; identity instability reports inventory_busy, never ownership.
// Caller handles bounded retry/budget and separately checks the busy namespace layout.
export async function readJournalSnapshot(options: Options): Promise<LaunchJournal> {
  const reader = await openJournalAccess(options, {}, true);
  try {
    return await reader.read();
  } finally {
    await reader.close();
  }
}

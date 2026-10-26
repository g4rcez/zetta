import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, opendir, statfs } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";

export type JournalLayoutStage = "mkdir" | "lock_create" | "lock_sync" | "lock_close" | "receipt_sync" | "root_sync" | "recheck";
type Code = "inventory_busy" | "journal_invalid_files" | "journal_recovery_required" | "journal_capacity" | "journal_durability_unknown" | "journal_busy" | "journal_closed" | "capability_unavailable";
export class JournalLayoutError extends Error {
  readonly name = "JournalLayoutError";
  constructor(readonly code: Code, readonly stage?: JournalLayoutStage) { super(code); }
}
// Privileged construction-only fault observers, never serialized configuration.
export type JournalLayoutFaults = Readonly<{ before?: (stage: JournalLayoutStage) => Promise<void>; after?: (stage: JournalLayoutStage) => Promise<void> }>;
type Held = Readonly<{ path: string; handle: FileHandle; stat: Stats }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid = () => new JournalLayoutError("journal_invalid_files");
const recovery = () => new JournalLayoutError("journal_recovery_required");
const identity = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
function valid(stat: Stats, uid: number, directory: boolean) {
  return stat.uid === uid && (stat.mode & 0o7777) === (directory ? 0o700 : 0o600)
    && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1);
}
async function verify(held: Held, uid: number, directory: boolean, observational = false) {
  const current = await held.handle.stat();
  let named: Stats;
  try { named = await lstat(held.path); }
  catch (error) {
    if (observational && error instanceof Error && "code" in error && error.code === "ENOENT") throw new JournalLayoutError("inventory_busy");
    throw error;
  }
  if (observational && valid(named, uid, directory) && !identity(current, named)) throw new JournalLayoutError("inventory_busy");
  if (!valid(current, uid, directory) || !valid(named, uid, directory) || !identity(held.stat, current) || !identity(current, named)) throw invalid();
}
async function retain(path: string, uid: number, directory: boolean, observational = false): Promise<Held> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0));
  try { const held = { path, handle, stat: await handle.stat() }; await verify(held, uid, directory, observational); return held; }
  catch (error) { await handle.close(); if (error instanceof JournalLayoutError && error.code === "inventory_busy") throw error; throw invalid(); }
}
async function ancestors(root: string, uid: number) {
  for (let path = dirname(root);; path = dirname(path)) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== uid) || (stat.mode & 0o7022) !== 0) throw invalid();
    if (path === dirname(path)) return;
  }
}
async function entries(path: string, limit: number): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of await opendir(path)) {
    if (names.length === limit) throw new JournalLayoutError("journal_capacity");
    names.push(entry.name);
  }
  return names;
}
async function boundedKernelFile(path: string, limit: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw invalid();
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (!length || length > limit) throw invalid();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally { await file.close(); }
}
function kernelPath(raw: string) {
  const decoded = raw.replace(/\\(040|011|012|134)/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
  if (/\\(?!040|011|012|134)/.test(raw)) throw invalid();
  if (!decoded.startsWith("/") || decoded.includes("\0")) throw invalid();
  return decoded;
}
async function linuxProfile(root: Held) {
  if (process.platform !== "linux") throw invalid();
  const fs = await statfs(`/proc/self/fd/${root.handle.fd}`, { bigint: true });
  if (fs.type !== 0xef53n) throw invalid();
  const info = await boundedKernelFile(`/proc/self/fdinfo/${root.handle.fd}`, 4096);
  const ids = [...info.matchAll(/^mnt_id:\s*(\d+)$/gm)];
  const id = ids[0]?.[1];
  if (ids.length !== 1 || !id) throw invalid();
  const matches = (await boundedKernelFile("/proc/self/mountinfo", 65536)).split("\n").filter(line => line.split(" ")[0] === id);
  if (matches.length !== 1 || !matches[0]) throw invalid();
  const halves = matches[0].split(" - "), left = halves[0]?.split(" "), right = halves[1]?.split(" ");
  if (halves.length !== 2 || !left || left.length < 6 || !right || right.length !== 3 || right[0] !== "ext4"
    || !left[5]?.split(",").includes("rw") || !right[2]?.split(",").includes("rw")) throw invalid();
  if (!left[3] || !left[4]) throw invalid();
  kernelPath(left[3]); kernelPath(left[4]);
  const device = left[2];
  if (!device || !/^\d+:\d+$/.test(device)) throw invalid();
  if (!Number.isSafeInteger(root.stat.dev)) throw invalid();
  const dev = BigInt(root.stat.dev), major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  if (device !== `${major}:${minor}` || major === 0n) throw invalid();
  if (!(await lstat(`/sys/dev/block/${device}`)).isSymbolicLink()) throw invalid();
}

// INTERNAL primitives: caller owns admission for scan/allocation, receipt for idle inspection.
// inventory_busy during busy inspection requires one bounded caller retry, never poison.
// Busy inspection observes names only; canonical record reading is a separate snapshot call.
// No lock, timeout, repair, initial record, effect authority or Linux proof is provided here.
export async function openJournalLayout(options: Readonly<{ root: string; uid: number }>, suppliedFaults: JournalLayoutFaults = {}) {
  const { root, uid } = options, faults = Object.freeze({ ...suppliedFaults });
  let held: Held;
  try {
    if (!isAbsolute(root) || normalize(root) !== root || root === "/" || root.endsWith("/") || root.includes("\0") || !Number.isInteger(uid) || uid < 0 || uid > 2 ** 32 - 1) throw invalid();
    await ancestors(root, uid); held = await retain(root, uid, true);
  } catch { throw invalid(); }
  let active = false, closed = false, poisoned = false;
  async function recheck() { await ancestors(root, uid); await verify(held, uid, true); }
  async function run<T>(work: () => Promise<T>): Promise<T> {
    if (poisoned) throw new JournalLayoutError("journal_durability_unknown");
    if (closed) throw new JournalLayoutError("journal_closed");
    if (active) throw new JournalLayoutError("journal_busy");
    active = true;
    try { await recheck(); return await work(); }
    catch (error) { if (error instanceof JournalLayoutError) throw error; throw invalid(); }
    finally { active = false; }
  }
  async function inspect(path: string, directory: boolean, empty = false, observational = false) {
    const file = await retain(path, uid, directory, observational);
    try { if (file.stat.dev !== held.stat.dev || (empty && file.stat.size !== 0)) throw invalid(); }
    finally { await file.handle.close(); }
  }
  return Object.freeze({
    async scanRoot(): Promise<readonly string[]> { return run(async () => {
      const names = await entries(root, 1025), receipts: string[] = [];
      if (!names.includes(".admission.lock")) throw recovery();
      await inspect(join(root, ".admission.lock"), false, true);
      for (const name of names) {
        if (name === ".admission.lock") continue;
        if (!uuid.test(name)) throw recovery();
        await inspect(join(root, name), true); receipts.push(name);
      }
      if (receipts.length > 1024) throw new JournalLayoutError("journal_capacity");
      await recheck(); return Object.freeze(receipts.sort());
    }); },
    async inspectReceipt(receiptId: string, mode: "idle" | "busy"): Promise<Readonly<{ staging: boolean }>> { return run(async () => {
      if (!uuid.test(receiptId) || (mode !== "idle" && mode !== "busy")) throw invalid();
      const directory = await retain(join(root, receiptId), uid, true);
      try {
        if (directory.stat.dev !== held.stat.dev) throw invalid();
        const names = await entries(directory.path, 3);
        if (!names.includes(".writer.lock") || !names.includes("record.json") || names.some(name => ![".writer.lock", "record.json", "record.next"].includes(name))) throw recovery();
        if (mode === "idle" && names.includes("record.next")) throw recovery();
        for (const name of names) {
          try { await inspect(join(directory.path, name), false, name === ".writer.lock", mode === "busy" && name !== ".writer.lock"); }
          catch (error) {
            if (!(mode === "busy" && name === "record.next" && error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          }
        }
        await verify(directory, uid, true); await recheck();
        return Object.freeze({ staging: names.includes("record.next") });
      } finally { await directory.handle.close(); }
    }); },
    async allocate(receiptId: string): Promise<void> { return run(async () => {
      if (!uuid.test(receiptId)) throw invalid();
      let stage: JournalLayoutStage = "mkdir", directory: Held | undefined, lock: FileHandle | undefined, lockStat: Stats | undefined;
      async function step(name: JournalLayoutStage, operation: () => Promise<void>) {
        stage = name; await faults.before?.(name); await operation(); await faults.after?.(name);
      }
      try {
        await step("mkdir", async () => { await mkdir(join(root, receiptId), { mode: 0o700 }); });
        directory = await retain(join(root, receiptId), uid, true);
        const receipt = directory;
        if (receipt.stat.dev !== held.stat.dev) throw invalid();
        await step("lock_create", async () => {
          const path = join(receipt.path, ".writer.lock");
          lock = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
          const stat = await lock.stat(); lockStat = stat; await verify({ path, handle: lock, stat }, uid, false);
          if (stat.size !== 0 || stat.dev !== held.stat.dev) throw invalid();
        });
        if (!lock) throw invalid();
        const created = lock;
        await step("lock_sync", () => created.sync());
        await step("lock_close", async () => { await created.close(); lock = undefined; });
        await step("receipt_sync", () => receipt.handle.sync());
        await step("root_sync", () => held.handle.sync());
        await step("recheck", async () => { await verify(receipt, uid, true); await inspect(join(receipt.path, ".writer.lock"), false, true);
          if (!lockStat || !identity(lockStat, await lstat(join(receipt.path, ".writer.lock")))) throw invalid(); await recheck(); });
      } catch { poisoned = true; throw new JournalLayoutError("journal_durability_unknown", stage); }
      finally {
        try { try { await lock?.close(); } finally { await directory?.handle.close(); } }
        catch { poisoned = true; throw new JournalLayoutError("journal_durability_unknown", stage); }
      }
    }); },
    async verifyLinuxProfile(): Promise<void> { return run(async () => {
      try { await linuxProfile(held); await recheck(); } catch { throw new JournalLayoutError("capability_unavailable"); }
    }); },
    async close(): Promise<void> {
      if (active) throw new JournalLayoutError("journal_busy");
      if (closed) return;
      closed = true;
      try { await held.handle.close(); } catch { throw invalid(); }
    },
  });
}

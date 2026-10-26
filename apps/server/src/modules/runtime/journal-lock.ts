import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { z } from "zod";

const policySchema = z.strictObject({
  root: z.string().min(1).max(4096).refine(value => isAbsolute(value) && normalize(value) === value && value !== "/" && !value.endsWith("/") && !value.includes("\0")),
  uid: z.number().int().min(0).max(2 ** 32 - 1),
  scope: z.discriminatedUnion("type", [z.strictObject({ type: z.literal("admission") }).readonly(),
    z.strictObject({ type: z.literal("receipt"), receiptId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) }).readonly()]),
  flock: z.strictObject({ sourceVersion: z.enum(["2.39.3", "2.41.3"]), sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().min(1).max(16_777_216) }).readonly(),
  bunVersion: z.string().regex(/^\d+\.\d+\.\d+$/), bunRevision: z.string().regex(/^[a-f0-9]{8,40}$/),
}).readonly();
export type JournalLockPolicy = z.infer<typeof policySchema>;
type Code = "invalid_lock_policy" | "capability_unavailable" | "journal_locked" | "journal_lock_invalid" | "journal_lock_busy" | "journal_lock_closed";
export class JournalLockError extends Error {
  readonly name = "JournalLockError";
  constructor(readonly code: Code) { super(code); }
}
export function parseJournalLockPolicy(raw: unknown): JournalLockPolicy {
  const parsed = policySchema.safeParse(raw);
  if (!parsed.success) throw new JournalLockError("invalid_lock_policy");
  return parsed.data;
}
export type JournalLockOwner = Readonly<{ recheck(): Promise<void>; close(): Promise<void> }>;
export type JournalLockAttempt = Readonly<{ ready: Promise<JournalLockOwner>; settled: Promise<void> }>;
type Held = Readonly<{ path: string; file: FileHandle; stat: Stats; kind: "directory" | "lock" | "binary" }>;
const unavailable = () => new JournalLockError("capability_unavailable");
const identity = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
function valid(stat: Stats, kind: Held["kind"], uid: number) {
  if (kind === "binary") return stat.isFile() && stat.nlink === 1 && (stat.uid === 0 || stat.uid === uid)
    && (stat.mode & 0o7022) === 0 && (stat.mode & 0o111) !== 0;
  return stat.uid === uid && (stat.mode & 0o7777) === (kind === "directory" ? 0o700 : 0o600)
    && (kind === "directory" ? stat.isDirectory() : stat.isFile() && stat.nlink === 1 && stat.size === 0);
}
async function ancestors(path: string, uid: number) {
  for (let parent = dirname(path);; parent = dirname(parent)) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== uid) || (stat.mode & 0o7022) !== 0) throw unavailable();
    if (parent === dirname(parent)) return;
  }
}
async function recheckHeld(held: Held, uid: number) {
  const current = await held.file.stat(), named = await lstat(held.path);
  if (!valid(current, held.kind, uid) || !valid(named, held.kind, uid) || !identity(held.stat, current) || !identity(current, named)) throw unavailable();
  if (held.kind === "binary" && (current.size !== held.stat.size || current.mtimeMs !== held.stat.mtimeMs || current.ctimeMs !== held.stat.ctimeMs
    || named.size !== current.size || named.mtimeMs !== current.mtimeMs || named.ctimeMs !== current.ctimeMs)) throw unavailable();
}
async function retain(path: string, kind: Held["kind"], uid: number, files: Held[]) {
  const file = await open(path, (kind === "lock" ? constants.O_RDWR : constants.O_RDONLY)
    | constants.O_NOFOLLOW | constants.O_NONBLOCK | (kind === "directory" ? constants.O_DIRECTORY : 0));
  let held: Held;
  try { held = { path, file, stat: await file.stat(), kind }; }
  catch { await file.close(); throw unavailable(); }
  files.push(held);
  if (file.fd < 3) throw unavailable();
  await recheckHeld(held, uid);
  return held;
}
async function verifyPin(binary: Held, policy: JournalLockPolicy) {
  if (binary.stat.size !== policy.flock.byteLength) throw unavailable();
  const chunk = Buffer.alloc(65536), hash = createHash("sha256");
  let offset = 0;
  while (offset < policy.flock.byteLength) {
    const { bytesRead } = await binary.file.read(chunk, 0, Math.min(chunk.length, policy.flock.byteLength - offset), offset);
    if (!bytesRead) throw unavailable();
    hash.update(chunk.subarray(0, bytesRead)); offset += bytesRead;
  }
  if ((await binary.file.read(chunk, 0, 1, offset)).bytesRead !== 0 || hash.digest("hex") !== policy.flock.sha256) throw unavailable();
  await recheckHeld(binary, policy.uid);
}
async function closeHeld(files: Held[]) {
  let failed = false;
  for (const held of [...files].reverse()) { try { await held.file.close(); } catch { failed = true; } }
  if (failed) throw unavailable();
}

// Trusted launcher construction only. Caller must consume ready AND settled. On failure,
// settled confirms helper/work/descriptor cleanup; a timed-out ready never grants retry.
// Successful ready transfers retained descriptors to owner.close, not actor/effect authority.
// This primitive does not establish ext4/systemd or a previously unproved binary profile.
// Privileged test observer only: no request/config field, no replacement helper/platform.
// It receives only the exact tracked PID; its return value is never awaited or authoritative.
export function beginJournalLock(raw: unknown, afterSpawn?: (pid: number) => void): JournalLockAttempt {
  const policy = parseJournalLockPolicy(raw);
  if (process.platform !== "linux" || process.getuid?.() !== policy.uid || Bun.version !== policy.bunVersion || Bun.revision !== policy.bunRevision) throw unavailable();
  const ready = Promise.withResolvers<JournalLockOwner>(), settled = Promise.withResolvers<void>();
  const files: Held[] = [];
  let helper: Bun.Subprocess<number, "ignore", "ignore"> | undefined;
  let expired = false, transferred = false;
  const deadline = performance.now() + 5000;
  function expire() {
    expired = true; ready.reject(unavailable());
    try { helper?.kill("SIGKILL"); } catch { /* Exact helper settlement is still awaited. */ }
  }
  const timer = setTimeout(expire, 5000);
  function live() { if (expired || performance.now() >= deadline) { expire(); throw unavailable(); } }
  async function validateOwner() {
    await ancestors(policy.root, policy.uid);
    await ancestors("/usr/bin/flock", policy.uid);
    for (const held of files) await recheckHeld(held, policy.uid);
  }
  async function acquire() {
    try {
      await ancestors(policy.root, policy.uid); live();
      await ancestors("/usr/bin/flock", policy.uid); live();
      const binary = await retain("/usr/bin/flock", "binary", policy.uid, files);
      await verifyPin(binary, policy); live();
      const root = await retain(policy.root, "directory", policy.uid, files);
      const directory = policy.scope.type === "receipt" ? await retain(join(policy.root, policy.scope.receiptId), "directory", policy.uid, files) : root;
      if (directory.stat.dev !== root.stat.dev) throw unavailable();
      const lock = await retain(join(directory.path, policy.scope.type === "receipt" ? ".writer.lock" : ".admission.lock"), "lock", policy.uid, files);
      if (lock.stat.dev !== root.stat.dev) throw unavailable();
      await validateOwner(); live();
      helper = Bun.spawn(["/usr/bin/flock", "-x", "-n", "-E", "75", "0"], {
        stdin: lock.file.fd, stdout: "ignore", stderr: "ignore", env: { LANG: "C", LC_ALL: "C" },
      });
      afterSpawn?.(helper.pid); live();
      const code = await helper.exited;
      live();
      if (helper.signalCode !== null) throw unavailable();
      if (code === 75) throw new JournalLockError("journal_locked");
      if (code !== 0) throw unavailable();
      await validateOwner(); live();
      let closed = false, busy = false, invalid = false;
      const owner: JournalLockOwner = Object.freeze({
        async recheck() {
          if (closed) throw new JournalLockError("journal_lock_closed");
          if (invalid) throw new JournalLockError("journal_lock_invalid");
          if (busy) throw new JournalLockError("journal_lock_busy");
          busy = true;
          try { await validateOwner(); }
          catch { invalid = true; throw new JournalLockError("journal_lock_invalid"); }
          finally { busy = false; }
        },
        async close() {
          if (busy) throw new JournalLockError("journal_lock_busy");
          if (closed) return;
          closed = true; await closeHeld(files);
        },
      });
      transferred = true; clearTimeout(timer); ready.resolve(owner);
    } catch (error) {
      try { helper?.kill("SIGKILL"); } catch { /* Settlement below still owns descriptors. */ }
      ready.reject(error instanceof JournalLockError ? error : unavailable());
    } finally {
      clearTimeout(timer);
      try {
        // In particular, timeout is not permission to close a helper's shared description.
        if (helper) await helper.exited;
        if (!transferred) await closeHeld(files);
        settled.resolve();
      } catch { settled.reject(unavailable()); }
    }
  }
  void acquire();
  return Object.freeze({ ready: ready.promise, settled: settled.promise });
}

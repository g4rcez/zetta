import { expect, spyOn, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { renameSync } from "node:fs";
import type { BigIntStats, PathLike, StatOptions, Stats } from "node:fs";
import { join, resolve } from "node:path";
import { openJournalLayout } from "./journal-layout";
import type { JournalLayoutStage } from "./journal-layout";
const receipt = "11111111-1111-4111-8111-111111111111";
async function fixture(run: (root: string, uid: number) => Promise<void>) {
  const suite = await mkdtemp(join(resolve("."), ".journal-008d3b-")), root = join(suite, "journal");
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("uid unavailable");
  await chmod(suite, 0o700); await mkdir(root, { mode: 0o700 });
  await writeFile(join(suite, "unrelated"), "preserve bytes", { mode: 0o600 });
  await writeFile(join(root, ".admission.lock"), "", { mode: 0o600 });
  try { await run(root, uid); }
  finally {
    expect(await readFile(join(suite, "unrelated"), "utf8")).toBe("preserve bytes");
    await rm(suite, { recursive: true });
    expect((await readdir(resolve("."))).includes(suite.split("/").at(-1) ?? "")).toBe(false);
    console.info(JSON.stringify({ fixture: suite, platform: process.platform, bun: Bun.version, cleanup: "exact_absent", unrelated: "preserved" }));
  }
}
test("exclusive allocation syncs permanent empty lock in order; incomplete receipt blocks idle inspection", async () => fixture(async (root, uid) => {
  const stages: string[] = [];
  const layout = await openJournalLayout({ root, uid }, { after: async stage => { stages.push(stage); } });
  try {
    expect(await layout.scanRoot()).toEqual([]);
    await layout.allocate(receipt);
    expect(stages).toEqual(["mkdir", "lock_create", "lock_sync", "lock_close", "receipt_sync", "root_sync", "recheck"]);
    expect(await layout.scanRoot()).toEqual([receipt]);
    const lock = await lstat(join(root, receipt, ".writer.lock"));
    expect(lock.mode & 0o7777).toBe(0o600); expect(lock.size).toBe(0); expect(lock.nlink).toBe(1);
    await expect(layout.inspectReceipt(receipt, "idle")).rejects.toThrow("journal_recovery_required");
    await expect(layout.allocate(receipt)).rejects.toThrow("journal_durability_unknown");
    expect((await lstat(join(root, receipt, ".writer.lock"))).ino).toBe(lock.ino);
  } finally { await layout.close(); }
}));
test("busy staging is observational; idle staging persists as recovery gate", async () => fixture(async (root, uid) => {
  const layout = await openJournalLayout({ root, uid });
  try {
    await layout.allocate(receipt);
    await writeFile(join(root, receipt, "record.json"), "{}\n", { mode: 0o600 });
    await writeFile(join(root, receipt, "record.next"), "partial", { mode: 0o600 });
    expect(await layout.inspectReceipt(receipt, "busy")).toEqual({ staging: true });
    await expect(layout.inspectReceipt(receipt, "idle")).rejects.toThrow("journal_recovery_required");
    expect(await readFile(join(root, receipt, "record.next"), "utf8")).toBe("partial");
  } finally { await layout.close(); }
}));
for (const stage of ["mkdir", "lock_create", "lock_sync", "lock_close", "receipt_sync", "root_sync", "recheck"] satisfies JournalLayoutStage[]) {
  test(`allocation failure after ${stage} is private, sticky and retains namespace`, async () => fixture(async (root, uid) => {
    const layout = await openJournalLayout({ root, uid }, { after: async current => { if (current === stage) throw new Error("private EIO"); } });
    try {
      await expect(layout.allocate(receipt)).rejects.toThrow("journal_durability_unknown");
      expect((await readdir(root)).includes(receipt)).toBe(true);
      await expect(layout.scanRoot()).rejects.toThrow("journal_durability_unknown");
    } finally { await layout.close(); }
  }));
}
test("unexpected entries, traversal, symlinks and permissive locks deny without adoption", async () => fixture(async (root, uid) => {
  const layout = await openJournalLayout({ root, uid });
  try {
    await expect(layout.allocate("../escape")).rejects.toThrow("journal_invalid_files");
    await writeFile(join(root, "unexpected"), "keep");
    await expect(layout.scanRoot()).rejects.toThrow("journal_recovery_required");
    await rm(join(root, "unexpected"));
    await symlink(root, join(root, receipt));
    await expect(layout.scanRoot()).rejects.toThrow("journal_invalid_files");
    await rm(join(root, receipt));
    await chmod(join(root, ".admission.lock"), 0o644);
    await expect(layout.scanRoot()).rejects.toThrow("journal_invalid_files");
  } finally { await layout.close(); }
}));
test("actual platform profile cannot be overridden; Mac filesystem result is not Linux proof", async () => fixture(async (root, uid) => {
  const layout = await openJournalLayout({ root, uid });
  try {
    if (process.platform !== "linux") await expect(layout.verifyLinuxProfile()).rejects.toThrow("capability_unavailable");
    else throw new Error("this Mac proof scenario requires separate reviewed Linux invocation");
  } finally { await layout.close(); }
}));

test("bounded root scan accepts1024 receipts and refuses1025 without deleting", async () => fixture(async (root, uid) => {
  const layout = await openJournalLayout({ root, uid });
  try {
    for (let index = 0; index < 1024; index++) await mkdir(join(root, `11111111-1111-4111-8111-${index.toString(16).padStart(12, "0")}`), { mode: 0o700 });
    expect(await layout.scanRoot()).toHaveLength(1024);
    await mkdir(join(root, receipt), { mode: 0o700 });
    await expect(layout.scanRoot()).rejects.toThrow("journal_capacity");
    expect(await readdir(root)).toHaveLength(1026);
  } finally { await layout.close(); }
}));

test("allocation pending I/O retains root and rejects overlapping close/work", async () => fixture(async (root, uid) => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const layout = await openJournalLayout({ root, uid }, { before: async stage => {
    if (stage === "root_sync") { entered.resolve(); await release.promise; }
  } });
  const pending = layout.allocate(receipt);
  try {
    await entered.promise;
    await expect(layout.close()).rejects.toThrow("journal_busy");
    await expect(layout.scanRoot()).rejects.toThrow("journal_busy");
  } finally { release.resolve(); await pending; await layout.close(); }
  await expect(layout.scanRoot()).rejects.toThrow("journal_closed");
}));

test("allocation detects permanent lock replacement at final recheck", async () => fixture(async (root, uid) => {
  const layout = await openJournalLayout({ root, uid }, { before: async stage => {
    if (stage === "recheck") {
      await rm(join(root, receipt, ".writer.lock"));
      await writeFile(join(root, receipt, ".writer.lock"), "replacement", { mode: 0o600 });
    }
  } });
  try { await expect(layout.allocate(receipt)).rejects.toThrow("journal_durability_unknown"); }
  finally { await layout.close(); }
}));

test("invalid owner/root and missing admission are refused without provisioning", async () => fixture(async (root, uid) => {
  await expect(openJournalLayout({ root, uid: uid + 1 })).rejects.toThrow("journal_invalid_files");
  await expect(openJournalLayout({ root: root + "/", uid })).rejects.toThrow("journal_invalid_files");
  await chmod(root, 0o777);
  await expect(openJournalLayout({ root, uid })).rejects.toThrow("journal_invalid_files");
  await chmod(root, 0o700);
  await rm(join(root, ".admission.lock"));
  const layout = await openJournalLayout({ root, uid });
  try { await expect(layout.scanRoot()).rejects.toThrow("journal_recovery_required"); }
  finally { await layout.close(); }
  expect(await readdir(root)).toEqual([]);
}));

for (const mode of ["busy", "idle"] as const) test(`actual rename between record open and named verification: ${mode}`, async () => fixture(async (root, uid) => {
  const layout = await openJournalLayout({ root, uid });
  const current = join(root, receipt, "record.json");
  await layout.allocate(receipt);
  await writeFile(current, "old complete bytes", { mode: 0o600 });
  // Keep the replacement outside the inspected namespace until the exact race point.
  const staged = join(root, "replacement");
  await writeFile(staged, "new complete bytes", { mode: 0o600 });
  const before = await lstat(current), original = filesystem.lstat;
  let renamed = false;
  function observed(path: PathLike, options?: StatOptions & { bigint?: false | undefined }): Promise<Stats>;
  function observed(path: PathLike, options: StatOptions & { bigint: true }): Promise<BigIntStats>;
  function observed(path: PathLike, options?: StatOptions): Promise<Stats | BigIntStats>;
  function observed(path: PathLike, options?: StatOptions): Promise<Stats | BigIntStats> {
    if (path === current && !renamed) { renamed = true; renameSync(staged, current); }
    return original(path, options);
  }
  const observer = spyOn(filesystem, "lstat").mockImplementation(observed);
  try {
    await expect(layout.inspectReceipt(receipt, mode)).rejects.toThrow(mode === "busy" ? "inventory_busy" : "journal_invalid_files");
    expect(await layout.inspectReceipt(receipt, mode)).toEqual({ staging: false });
  } finally { observer.mockRestore(); await layout.close(); }
  expect(renamed).toBe(true);
  expect((await lstat(current)).ino).not.toBe(before.ino);
  expect(await readFile(current, "utf8")).toBe("new complete bytes");
}));

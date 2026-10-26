import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { openJournalStore } from "../../apps/server/src/modules/runtime/journal-store";
import type { JournalStore } from "../../apps/server/src/modules/runtime/journal-store";
import { JournalStoreError } from "../../apps/server/src/modules/runtime/journal-owner";
import type { JournalOwner } from "../../apps/server/src/modules/runtime/journal-owner";
import type { LaunchJournal } from "../../apps/server/src/modules/runtime/launch-journal";

const suite = "/var/lib/zetta-store-proof-894d5c47-5c0e-418d-923f-3dd2260b943e", root = `${suite}/journal`;
const policyHash = "90b5844a291a8159f0babc992aadad58af7b421c9fd6a960002d353721559429";
const policyVersion = "fixture-store-v1", operationId = "33333333-3333-4333-8333-333333333333";
const stagingBytes = Buffer.from("synthetic interrupted staging\n");
let outputBytes = 0, currentCase = "guard";
function assert(value: unknown): asserts value { if (!value) throw new Error("fixture_assertion"); }
function emit(row: Readonly<Record<string, string | number | boolean>>) {
  const line = JSON.stringify(row) + "\n";
  outputBytes += Buffer.byteLength(line);
  if (outputBytes > 8192) process.exit(125);
  process.stdout.write(line);
}
async function names(path: string, cap: number) {
  const result: string[] = [];
  for await (const entry of await opendir(path)) { assert(result.length < cap); result.push(entry.name); }
  return result.sort();
}
async function configuration(): Promise<unknown> {
  const path = join(suite, "policy.json"), file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    assert(before.isFile() && before.uid === 0 && before.nlink === 1 && (before.mode & 0o7777) === 0o444 && before.size > 0 && before.size <= 8192);
    const bytes = Buffer.alloc(8193); let length = 0;
    while (length < bytes.length) { const read = await file.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    const after = await file.stat(), named = await lstat(path);
    assert(length === before.size && after.dev === before.dev && after.ino === before.ino && after.size === before.size
      && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs && named.dev === after.dev && named.ino === after.ino
      && named.uid === 0 && named.nlink === 1 && (named.mode & 0o7777) === 0o444);
    const bounded = bytes.subarray(0, length); assert(createHash("sha256").update(bounded).digest("hex") === policyHash);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bounded));
  } finally { await file.close(); }
}
async function denied(work: () => Promise<unknown>, code: string) {
  let observed = false;
  try { await work(); } catch (error) { assert(error instanceof JournalStoreError && error.code === code); observed = true; }
  assert(observed);
}
function authority(record: LaunchJournal) {
  return { receiptId: record.receiptId, attemptId: record.spec.context.attemptId, leaseId: record.spec.leaseId, fence: record.spec.fence };
}
function clock(record: LaunchJournal) { const now = Date.now(); assert(now >= record.observedAtEpochMs); return now; }
function spec(attemptId: string, deadlineEpochMs: number) {
  return { version: 1, context: { actorId: "synthetic-actor", runId: attemptId, attemptId, botId: "fixture-bot", conversationId: "fixture-chat", configurationId: "fixture-config" },
    leaseId: `${attemptId}-lease`, fence: 1, recipe: "fixture-v1", fixtureCase: "echo", policyVersion, deadlineEpochMs,
    budgets: { deadlineMs: 60000, maxInputBytes: 65536, maxOutputBytes: 65536, maxFrameBytes: 8192 } };
}
async function caseRun(name: string, work: () => Promise<Readonly<Record<string, string | number | boolean>>>) {
  currentCase = name;
  const timer = setTimeout(() => { emit({ case: name, result: "unproven", settled: false }); process.exit(124); }, 12000);
  try { emit({ case: name, result: "pass", ...await work() }); } finally { clearTimeout(timer); }
}
async function stage(receiptId: string) {
  assert(/^[0-9a-f-]{36}$/.test(receiptId));
  const directory = await open(join(root, receiptId), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const file = await open(join(root, receiptId, "record.next"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = await file.stat(); assert(stat.uid === 1000 && stat.nlink === 1 && stat.isFile() && (stat.mode & 0o7777) === 0o600);
      let offset = 0;
      while (offset < stagingBytes.length) { const result = await file.write(stagingBytes, offset, stagingBytes.length - offset, offset); assert(result.bytesWritten > 0); offset += result.bytesWritten; }
      await file.sync();
    } finally { await file.close(); }
    await directory.sync();
  } finally { await directory.close(); }
}
async function retainedStage(receiptId: string) {
  const file = await open(join(root, receiptId, "record.next"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat(); assert(stat.size === stagingBytes.length && stat.isFile() && stat.nlink === 1 && stat.uid === 1000 && (stat.mode & 0o7777) === 0o600);
    const bytes = Buffer.alloc(stagingBytes.length + 1); let offset = 0;
    while (offset < bytes.length) { const result = await file.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
    assert(offset === stagingBytes.length && bytes.subarray(0, offset).equals(stagingBytes));
  } finally { await file.close(); }
}
async function proof() {
  const options = await configuration(), stores = new Set<JournalStore>();
  async function start() { const store = await openJournalStore(options); stores.add(store); return store; }
  async function close(store: JournalStore) { await store.close(); await store.settled; stores.delete(store); }
  let first: string | undefined, second: string | undefined, owner: JournalOwner | undefined;
  try {
    assert(JSON.stringify(await names(root, 2)) === '[".admission.lock"]');
    let store = await start();
    await caseRun("empty-factory", async () => { assert((await store.inventory()).length === 0); return { empty: true }; });
    const now = Date.now(), request = spec("fixture-attempt-a", now + 60000), admission = { nowEpochMs: now, authorizedDeadlineEpochMs: now + 60000, policyVersion };
    await caseRun("intent-replay-conflict", async () => {
      const created = await store.createIntent(request, admission); first = created.receiptId; assert(created.disposition === "created");
      const replay = await store.createIntent(request, { ...admission, nowEpochMs: request.deadlineEpochMs + 1 });
      assert(replay.receiptId === first && replay.disposition === "existing");
      await denied(() => store.createIntent({ ...request, fence: 2 }, admission), "journal_conflict");
      return { receiptId: first, clockControl: "synthetic-admission-only", replay: true, conflict: true };
    });
    assert(first); owner = await store.claimReceipt(first);
    await caseRun("busy-owner-snapshot", async () => {
      const inventory = await store.inventory(); assert(inventory.length === 1 && inventory[0]?.availability === "busy" && inventory[0].receiptId === first);
      await denied(() => store.claimReceipt(first ?? ""), "journal_locked"); return { busy: true, competingClaimDenied: true };
    });
    const initial = owner.snapshot();
    const pending = await owner.apply({ type: "begin", owner: authority(initial), atEpochMs: clock(initial), operation: { id: operationId, sequence: 1, type: "create", input: null } });
    assert(pending.pendingOperation?.id === operationId && !("effect" in pending));
    await owner.close(); await owner.settled; owner = undefined; await close(store);
    store = await start();
    await caseRun("commit-reopen-recovery", async () => {
      assert(first); owner = await store.claimReceipt(first); const loaded = owner.snapshot();
      assert(JSON.stringify(loaded) === JSON.stringify(pending));
      const recovered = await owner.apply({ type: "unknown", owner: authority(loaded), atEpochMs: clock(loaded), operationId, operationSequence: 1 });
      assert(recovered.phase === "quarantined" && recovered.outcomeUncertain && recovered.pendingOperation?.id === operationId && recovered.cancelIntent === "recovery");
      const cancelled = await owner.apply({ type: "cancel", owner: authority(recovered), atEpochMs: clock(recovered), reason: "recovery" });
      assert(cancelled.pendingOperation?.id === operationId && !("effect" in cancelled));
      return { canonicalReopen: true, pendingRetained: true, effectAuthorityReturned: false };
    });
    await caseRun("second-receipt", async () => {
      const time = Date.now(), created = await store.createIntent(spec("fixture-attempt-b", time + 60000), { nowEpochMs: time, authorizedDeadlineEpochMs: time + 60000, policyVersion });
      assert(created.disposition === "created" && created.receiptId !== first); second = created.receiptId;
      return { receiptId: second };
    });
    const checker = await start();
    await caseRun("idle-staging-admission-isolation", async () => {
      assert(first && second && owner);
      const idle = await store.claimReceipt(second);
      try { await stage(second); } finally { await idle.close(); await idle.settled; }
      let settled = false; void store.settled.then(() => { settled = true; }, () => {});
      await denied(() => store.inventory(), "journal_recovery_required");
      await denied(() => store.createIntent(request, admission), "journal_recovery_required");
      assert(!settled);
      const before = owner.snapshot(), atEpochMs = clock(before); assert(atEpochMs > before.observedAtEpochMs);
      const after = await owner.apply({ type: "unknown", owner: authority(before), atEpochMs, operationId, operationSequence: 1 });
      assert(after.observedAtEpochMs > before.observedAtEpochMs && after.pendingOperation?.id === operationId);
      await denied(() => checker.claimReceipt(first ?? ""), "journal_locked"); await retainedStage(second);
      return { admissionDenied: true, validOwnerProgress: true, retainedLock: true, stagingRetained: true, storeSettled: settled };
    });
    await caseRun("explicit-close", async () => {
      assert(first && second); await close(store); owner = undefined;
      const successor = await checker.claimReceipt(first);
      assert(successor.snapshot().phase === "quarantined"); await successor.close(); await successor.settled; await close(checker);
      await retainedStage(second);
      assert(JSON.stringify(await names(root, 4)) === JSON.stringify([".admission.lock", first, second].sort()));
      assert(JSON.stringify(await names(join(root, first), 3)) === JSON.stringify([".writer.lock", "record.json"]));
      assert(JSON.stringify(await names(join(root, second), 4)) === JSON.stringify([".writer.lock", "record.json", "record.next"]));
      await denied(() => openJournalStore(options), "journal_recovery_required");
      return { successorAcquired: true, persistentStageDenied: true, ownedStores: stores.size };
    });
  } finally {
    const results = await Promise.allSettled([...stores].map(store => close(store)));
    assert(results.every(result => result.status === "fulfilled"));
  }
  assert(stores.size === 0); emit({ case: "store-fixture", result: "pass", settled: true, ownedStores: 0, effectSubmissionPaths: false });
}

if (process.platform !== "linux" || process.arch !== "arm64" || process.getuid?.() !== 1000 || Bun.version !== "1.3.14"
  || Bun.revision !== "0d9b296af33f2b851fcbf4df3e9ec89751734ba4" || process.argv.length !== 2 || process.argv[1] !== `${suite}/store-proof.mjs`) {
  emit({ case: "guard", result: "denied" }); process.exitCode = 1;
} else {
  const deadline = setTimeout(() => { emit({ case: currentCase, result: "unproven", settled: false }); process.exit(124); }, 40000);
  try { await proof(); } catch { emit({ case: currentCase, result: "fail", settled: false }); process.exitCode = 1; }
  finally { clearTimeout(deadline); }
}

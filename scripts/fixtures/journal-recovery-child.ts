import { lstat } from "node:fs/promises";
import { openJournalStore } from "../../apps/server/src/modules/runtime/journal-store";
import { JournalStoreError } from "../../apps/server/src/modules/runtime/journal-owner";
import { decodeJournal } from "../../apps/server/src/modules/runtime/journal-codec";
import { assert, bytes, emit, guard, names, operationId, options, policy } from "./journal-crash-contract";
import type { Case } from "./journal-crash-contract";

async function recovery(id: Case) {
  const configuration = options(id), root = configuration.lock.root;
  const roots = await names(root, 3);
  assert(roots.includes(".admission.lock"));
  const receipts = roots.filter(name => name !== ".admission.lock");
  assert(receipts.length <= 1);
  const receiptId = receipts[0] ?? null;
  assert(id === "C0-insert" ? receiptId === null : receiptId !== null);
  const entries: { name: ".writer.lock" | "record.json" | "record.next"; size: number; sha256: string }[] = [];
  let current: Buffer | undefined;
  if (receiptId) {
    assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(receiptId));
    const directory = `${root}/${receiptId}`, stat = await lstat(directory);
    assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 1000 && (stat.mode & 0o7777) === 0o700);
    for (const name of await names(directory, 4)) {
      assert(name === ".writer.lock" || name === "record.json" || name === "record.next");
      const data = await bytes(`${directory}/${name}`);
      entries.push({ name, size: data.length, sha256: new Bun.CryptoHasher("sha256").update(data).digest("hex") });
      if (name === "record.json") {
        current = data; const decoded = decodeJournal(data, { receiptId, policy });
        assert(decoded.spec.context.attemptId === id && decoded.containerId === null);
      }
      if (name === "record.next" && id.startsWith("C4")) decodeJournal(data, { receiptId, policy });
      if (name === ".writer.lock") assert(data.length === 0);
    }
  }
  async function finalSnapshot() {
    const result: typeof entries = [];
    if (!receiptId) return result;
    for (const name of await names(`${root}/${receiptId}`, 4)) {
      assert(name === ".writer.lock" || name === "record.json" || name === "record.next");
      const data = await bytes(`${root}/${receiptId}/${name}`);
      result.push({ name, size: data.length, sha256: new Bun.CryptoHasher("sha256").update(data).digest("hex") });
      if (name === "record.json") decodeJournal(data, { receiptId, policy });
    }
    return result;
  }
  const blocked = ["C1-insert", "C2-insert", "C3-insert", "C4-sync-insert", "C4-insert", "C3-replace", "C4-sync-replace", "C4-replace"].includes(id);
  const expectedNames = id === "C0-insert" || id === "C1-insert" ? [] : id === "C2-insert" ? [".writer.lock"]
    : id === "C3-insert" || id === "C4-sync-insert" || id === "C4-insert" ? [".writer.lock", "record.next"]
    : id === "C3-replace" || id === "C4-sync-replace" || id === "C4-replace" ? [".writer.lock", "record.json", "record.next"] : [".writer.lock", "record.json"];
  assert(JSON.stringify(entries.map(entry => entry.name)) === JSON.stringify(expectedNames));
  if (id.startsWith("C3")) assert(entries.find(entry => entry.name === "record.next")?.size === 17);
  if (blocked) {
    let denied = false;
    try { const unexpected = await openJournalStore(configuration); await unexpected.close(); }
    catch (error) { assert(error instanceof JournalStoreError && error.code === "journal_recovery_required"); denied = true; }
    assert(denied);
    const finalEntries = await finalSnapshot();
    assert(JSON.stringify(finalEntries) === JSON.stringify(entries));
    emit({ type: "recovered", case: id, pid: process.pid, disposition: "blocked", receiptId, submissionPaths: false, initialEntries: entries, finalEntries });
    return;
  }
  const store = await openJournalStore(configuration);
  let disposition: "empty" | "inert" | "unknown" = "empty";
  try {
    if (!receiptId) assert(id === "C0-insert" && (await store.inventory()).length === 0);
    else {
      assert(current);
      const record = decodeJournal(current, { receiptId, policy });
      const inventory = await store.inventory(); assert(inventory.length === 1 && inventory[0]?.receiptId === receiptId);
      const replay = await store.createIntent(record.spec, { nowEpochMs: Date.now(), authorizedDeadlineEpochMs: record.spec.deadlineEpochMs, policyVersion: policy.policyVersion });
      assert(replay.disposition === "existing" && replay.receiptId === receiptId);
      const owner = await store.claimReceipt(receiptId);
      try {
        assert(JSON.stringify(owner.snapshot()) === JSON.stringify(record));
        disposition = "inert";
        if (record.pendingOperation) {
          assert(record.pendingOperation.id === operationId && record.pendingOperation.type === "create");
          const authority = { receiptId, attemptId: id, leaseId: record.spec.leaseId, fence: 1 };
          const unknown = await owner.apply({ type: "unknown", owner: authority, atEpochMs: Date.now(), operationId, operationSequence: 1 });
          assert(unknown.phase === "quarantined" && unknown.outcomeUncertain && unknown.cancelIntent === "recovery" && unknown.pendingOperation?.id === operationId);
          const cancelled = await owner.apply({ type: "cancel", owner: authority, atEpochMs: Date.now(), reason: "recovery" });
          assert(cancelled.outcomeUncertain && cancelled.pendingOperation?.id === operationId && !("effect" in cancelled));
          disposition = "unknown";
        }
      } finally { await owner.close(); await owner.settled; }
    }
  } finally { await store.close(); await store.settled; }
  const finalEntries = await finalSnapshot();
  if (disposition !== "unknown") assert(JSON.stringify(finalEntries) === JSON.stringify(entries));
  else {
    assert(receiptId && JSON.stringify(finalEntries.map(entry => entry.name)) === JSON.stringify(entries.map(entry => entry.name)));
    const final = decodeJournal(await bytes(`${root}/${receiptId}/record.json`), { receiptId, policy });
    assert(final.phase === "quarantined" && final.outcomeUncertain && final.cancelIntent === "recovery" && final.pendingOperation?.id === operationId);
    assert(finalEntries.find(entry => entry.name === "record.json")?.sha256 !== entries.find(entry => entry.name === "record.json")?.sha256);
  }
  emit({ type: "recovered", case: id, pid: process.pid, disposition, receiptId, submissionPaths: false, initialEntries: entries, finalEntries });
}
if (import.meta.main) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = guard("recovery"); assert(id);
    timer = setTimeout(() => process.exit(124), 12000);
    await recovery(id);
  } catch { process.stderr.write("recovery_unproved\n"); process.exitCode = 1; }
  finally { if (timer) clearTimeout(timer); }
}

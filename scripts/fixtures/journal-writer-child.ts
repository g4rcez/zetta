import { openJournalStore } from "../../apps/server/src/modules/runtime/journal-store";
import type { JournalFileFaults } from "../../apps/server/src/modules/runtime/journal-files";
import type { JournalLayoutFaults } from "../../apps/server/src/modules/runtime/journal-layout";
import { assert, boundary, emit, guard, operationId, options, policy, request } from "./journal-crash-contract";
import type { Case } from "./journal-crash-contract";

async function writer(id: Case) {
  let enabled = id.endsWith("insert"), captured = false, cut = false;
  const pause = async () => {
    assert(!cut && captured); cut = true;
    emit({ type: "cut", case: id, pid: process.pid, boundary: boundary(id), captured: true, atMs: Date.now() });
    await new Promise<never>(() => {});
  };
  const layout: { before: NonNullable<JournalLayoutFaults["before"]>; after: NonNullable<JournalLayoutFaults["after"]> } = {
    before: async stage => { if (enabled) { captured = true; if (id === "C0-insert" && stage === "mkdir") await pause(); } },
    after: async stage => {
      if (enabled && ((id === "C1-insert" && stage === "mkdir") || (id === "C2-insert" && stage === "root_sync"))) await pause();
    },
  };
  const files: { before: NonNullable<JournalFileFaults["before"]>; after: NonNullable<JournalFileFaults["after"]>; write: NonNullable<JournalFileFaults["write"]> } = {
    before: async stage => { if (enabled) { captured = true; if (id === "C0-replace" && stage === "create") await pause(); } },
    after: async stage => {
      if (!enabled) return;
      if ((id.startsWith("C4-sync-") && stage === "file_sync")
        || (id.startsWith("C4") && !id.includes("-sync-") && stage === "file_close") || (id.startsWith("C5") && stage === "rename")
        || (id.startsWith("C6") && stage === "directory_sync") || (id.startsWith("C7") && stage === "readback")) await pause();
    },
    write: async (handle, data, offset) => {
      const length = enabled && id.startsWith("C3") ? Math.min(17, data.length - offset) : data.length - offset;
      const result = await handle.write(data, offset, length, offset);
      if (enabled && id.startsWith("C3")) { assert(result.bytesWritten === 17 && offset === 0); await pause(); }
      return result.bytesWritten;
    },
  };
  const construction = openJournalStore(options(id), { layout, files });
  const changed = async () => { throw new Error("mutated_observer_selected"); };
  layout.before = changed; layout.after = changed; files.before = changed; files.after = changed; files.write = async () => { await changed(); return 0; };
  const store = await construction;
  const now = Date.now(), spec = request(id, now), admission = { nowEpochMs: now, authorizedDeadlineEpochMs: now + 60000, policyVersion: policy.policyVersion };
  if (id.endsWith("insert")) {
    emit({ type: "ready", case: id, pid: process.pid });
    await store.createIntent(spec, admission);
    throw new Error("unobserved_cut");
  }
  const created = await store.createIntent(spec, admission), owner = await store.claimReceipt(created.receiptId);
  enabled = true; captured = false;
  emit({ type: "ready", case: id, pid: process.pid });
  const record = owner.snapshot();
  const pending = await owner.apply({ type: "begin", owner: { receiptId: record.receiptId, attemptId: id, leaseId: record.spec.leaseId, fence: 1 },
    atEpochMs: Date.now(), operation: { id: operationId, sequence: 1, type: "create", input: null } });
  assert(id === "C8-effect" && captured && pending.pendingOperation?.id === operationId && !("effect" in pending));
  emit({ type: "effect", case: id, pid: process.pid, synthetic: true, count: 1 });
  await pause();
}
if (import.meta.main) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = guard("writer"); assert(id);
    timer = setTimeout(() => process.exit(124), 12000);
    await writer(id);
    process.exitCode = 1;
  } catch { process.stderr.write("writer_unproved\n"); process.exitCode = 1; }
  finally { if (timer) clearTimeout(timer); }
}

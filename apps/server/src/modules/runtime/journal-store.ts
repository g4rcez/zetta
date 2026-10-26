import { z } from "zod";
import { beginJournalLock, JournalLockError, parseJournalLockPolicy } from "./journal-lock";
import type { JournalLockOwner, JournalLockPolicy } from "./journal-lock";
import { openJournalLayout } from "./journal-layout";
import type { JournalLayoutFaults } from "./journal-layout";
import { openJournalFiles, readJournalSnapshot } from "./journal-files";
import type { JournalFileFaults } from "./journal-files";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";
import type { FixtureLaunchPolicy } from "./launch-recipe";
import { createLaunchJournal } from "./launch-journal";
import type { LaunchJournal } from "./launch-journal";
import { encodeJournal } from "./journal-codec";
import { parseStoredLaunchSpec } from "./launch-spec";
import type { LaunchAdmission, LaunchSpec } from "./launch-spec";
import { createJournalCallQueue, journalFailure, JournalStoreError, openJournalOwner } from "./journal-owner";
import type { JournalOwner } from "./journal-owner";

export type StoreOptions = Readonly<{ lock: Omit<JournalLockPolicy, "scope">; policy: FixtureLaunchPolicy }>;
export type JournalStoreFaults = Readonly<{ layout?: JournalLayoutFaults; files?: JournalFileFaults }>;
export type ReceiptSummary = Readonly<{ receiptId: string; availability: "idle" | "busy"; identityDigest: string; specDigest: string }>;
const rootSchema = z.strictObject({ lock: z.record(z.string(), z.unknown()), policy: z.unknown() });
const admissionSchema = z.strictObject({ nowEpochMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  authorizedDeadlineEpochMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), policyVersion: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).readonly();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function configuration(raw: unknown) {
  try {
    const parsed = rootSchema.parse(raw);
    if ("scope" in parsed.lock) throw new Error();
    return Object.freeze({ lock: parseJournalLockPolicy({ ...parsed.lock, scope: { type: "admission" } }), policy: createFixtureLaunchPolicy(parsed.policy) });
  } catch { throw new JournalStoreError("journal_invalid"); }
}
// Historical equality only: this helper never admits or restarts an attempt.
export function assertJournalReplay(existing: LaunchJournal, spec: LaunchSpec, policy: FixtureLaunchPolicy): void {
  const recipe = expandFixtureRecipe(spec, policy);
  if (existing.specDigest !== recipe.specDigest || existing.identityDigest !== recipe.identityDigest
    || JSON.stringify([existing.spec, existing.policy]) !== JSON.stringify([spec, policy])) throw new JournalStoreError("journal_conflict");
}
async function release(lock: JournalLockOwner) {
  try { await lock.close(); } catch { throw new JournalStoreError("journal_durability_unknown"); }
}
async function acquire(policy: JournalLockPolicy): Promise<JournalLockOwner> {
  const attempt = beginJournalLock(policy);
  let owner: JournalLockOwner | undefined;
  try { owner = await attempt.ready; await attempt.settled; return owner; }
  catch (error) {
    try { await attempt.settled; } finally { if (owner) await release(owner); }
    throw error;
  }
}
// Pure lifecycle composition: admission failure closes its own resources only.
// This is not a factory seam for replacing Linux locks/filesystem capability.
export function createJournalStoreLifetime(closeAdmission: () => Promise<void>) {
  const queue = createJournalCallQueue(closeAdmission), owners = new Set<Pick<JournalOwner, "close" | "settled">>();
  const settled = Promise.withResolvers<void>();
  let closing = false, ownerCleanupFailed = false;
  void settled.promise.catch(() => {});
  return Object.freeze({
    queue, settled: settled.promise,
    retain(owner: Pick<JournalOwner, "close" | "settled">) {
      owners.add(owner);
      void owner.settled.then(() => owners.delete(owner), () => { ownerCleanupFailed = true; owners.delete(owner); });
    },
    cleanupUnknown() { ownerCleanupFailed = true; },
    close(): Promise<void> {
      if (!closing) {
        closing = true;
        const admission = queue.close(), seals = [...owners].map(owner => owner.close());
        void (async () => {
          const initial = await Promise.allSettled([admission, ...seals]);
          // A claim already in initialization may retain its owner during the drain.
          // No new queue work remains after admission settles; close any such owner.
          const remaining = await Promise.allSettled([...owners].map(owner => owner.close()));
          if (ownerCleanupFailed || [...initial, ...remaining].some(result => result.status === "rejected")) throw new JournalStoreError("journal_durability_unknown");
        })().then(settled.resolve, () => settled.reject(new JournalStoreError("journal_durability_unknown")));
      }
      return settled.promise;
    },
  });
}
export async function openJournalStore(raw: unknown, suppliedFaults: JournalStoreFaults = {}) {
  const options = configuration(raw), base = Object.freeze({ root: options.lock.root, uid: options.lock.uid });
  // Trusted construction callbacks only; capture both nested selections before I/O.
  const { before: layoutBefore, after: layoutAfter } = suppliedFaults.layout ?? {};
  const { before, after, write } = suppliedFaults.files ?? {};
  const faults = Object.freeze({
    layout: Object.freeze({ ...(layoutBefore ? { before: layoutBefore } : {}), ...(layoutAfter ? { after: layoutAfter } : {}) }),
    files: Object.freeze({ ...(before ? { before } : {}), ...(after ? { after } : {}), ...(write ? { write } : {}) }),
  });
  if (process.platform !== "linux" || process.getuid?.() !== base.uid || Bun.version !== options.lock.bunVersion || Bun.revision !== options.lock.bunRevision) throw new JournalStoreError("capability_unavailable");
  let layout: Awaited<ReturnType<typeof openJournalLayout>>;
  try { layout = await openJournalLayout(base, faults.layout); } catch (error) { throw journalFailure(error); }
  const lifetime = createJournalStoreLifetime(() => layout.close()), queue = lifetime.queue;
  const receiptPolicy = (receiptId: string) => parseJournalLockPolicy({ ...options.lock, scope: { type: "receipt", receiptId } });
  const trust = (receiptId: string) => Object.freeze({ ...base, receiptId, policy: options.policy });
  async function admission<T>(check: () => void, work: () => Promise<T>) {
    await layout.verifyLinuxProfile(); check();
    const lock = await acquire(options.lock);
    try { check(); await lock.recheck(); check(); return await work(); }
    finally { await release(lock); }
  }
  async function scan(check: () => void, wantedAttempt?: string) {
    const names = await layout.scanRoot(); check();
    const summaries: ReceiptSummary[] = [], attempts = new Set<string>();
    let match: LaunchJournal | undefined;
    for (const receiptId of names) {
      check(); let lock: JournalLockOwner | undefined;
      try { lock = await acquire(receiptPolicy(receiptId)); }
      catch (error) { if (!(error instanceof JournalLockError) || error.code !== "journal_locked") throw error; }
      let record: LaunchJournal;
      if (lock) {
        try {
          check(); await lock.recheck(); await layout.inspectReceipt(receiptId, "idle"); check();
          const files = await openJournalFiles(trust(receiptId), faults.files);
          try { record = await files.read(); check(); await lock.recheck(); }
          finally { await files.close(); }
        } finally { await release(lock); }
      } else {
        const snapshot = async () => {
          await layout.inspectReceipt(receiptId, "busy"); check();
          return readJournalSnapshot(trust(receiptId));
        };
        try { record = await snapshot(); }
        catch (error) {
          if (journalFailure(error).code !== "journal_busy") throw error;
          check(); record = await snapshot();
        }
      }
      check();
      const key = record.spec.context.attemptId;
      if (attempts.has(key)) throw new JournalStoreError("journal_recovery_required");
      attempts.add(key);
      if (key === wantedAttempt) match = record;
      summaries.push(Object.freeze({ receiptId, availability: lock ? "idle" : "busy", identityDigest: record.identityDigest, specDigest: record.specDigest }));
    }
    return { summaries: Object.freeze(summaries), match };
  }
  const store = Object.freeze({
    settled: lifetime.settled, close: lifetime.close,
    inventory() { return queue.run(() => async check => admission(check, async () => (await scan(check)).summaries)); },
    createIntent(rawSpec: unknown, rawAdmission: LaunchAdmission) { return queue.run(() => {
      const spec = parseStoredLaunchSpec(rawSpec);
      const parsedAdmission = admissionSchema.safeParse(rawAdmission);
      if (!parsedAdmission.success) throw new JournalStoreError("journal_invalid");
      const recipe = expandFixtureRecipe(spec, options.policy);
      return async check => admission(check, async () => {
        const inventory = await scan(check, spec.context.attemptId); check();
        if (inventory.match) {
          const existing = inventory.match;
          assertJournalReplay(existing, spec, options.policy);
          return Object.freeze({ receiptId: existing.receiptId, disposition: "existing" as const });
        }
        if (inventory.summaries.length >= 1024) throw new JournalStoreError("journal_capacity");
        const initial = createLaunchJournal(recipe, parsedAdmission.data), trusted = trust(initial.receiptId);
        encodeJournal(initial, trusted); await layout.verifyLinuxProfile(); check();
        try {
          await layout.allocate(initial.receiptId); check();
          const lock = await acquire(receiptPolicy(initial.receiptId));
          try {
            check(); const files = await openJournalFiles(trusted, faults.files);
            try { check(); await files.commit(null, initial); check(); await lock.recheck(); await layout.inspectReceipt(initial.receiptId, "idle"); }
            finally { await files.close(); }
          } finally { await release(lock); }
          check(); return Object.freeze({ receiptId: initial.receiptId, disposition: "created" as const });
        } catch { throw new JournalStoreError("journal_durability_unknown"); }
      });
    }); },
    claimReceipt(receiptId: string): Promise<JournalOwner> { return queue.run(() => {
      if (typeof receiptId !== "string" || !uuid.test(receiptId)) throw new JournalStoreError("journal_invalid");
      return async check => {
        await layout.verifyLinuxProfile(); check();
        const lock = await acquire(receiptPolicy(receiptId));
        let owner: JournalOwner;
        try { check(); } catch (error) { await release(lock); throw error; }
        try { owner = await openJournalOwner(trust(receiptId), lock, faults.files); }
        catch (error) { if (journalFailure(error).code === "journal_durability_unknown") lifetime.cleanupUnknown(); throw error; }
        lifetime.retain(owner);
        try { check(); } catch (error) { await owner.close(); throw error; }
        return owner;
      };
    }); },
  });
  try { await store.inventory(); return store; }
  catch (error) { try { await store.close(); } catch { throw new JournalStoreError("journal_durability_unknown"); } throw journalFailure(error); }
}
export type JournalStore = Awaited<ReturnType<typeof openJournalStore>>;

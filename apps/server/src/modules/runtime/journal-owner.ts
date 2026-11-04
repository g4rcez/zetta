import { parseJournalEvent, JournalEventError } from "./journal-event";
import { JournalFileError, openJournalFiles } from "./journal-files";
import type { JournalFileFaults } from "./journal-files";
import { JournalLayoutError, openJournalLayout } from "./journal-layout";
import { JournalLockError } from "./journal-lock";
import type { JournalLockOwner } from "./journal-lock";
import { encodeJournal } from "./journal-codec";
import type { JournalTrust } from "./journal-codec";
import { LaunchJournalError, parseLaunchJournal } from "./launch-journal";
import type { LaunchJournal } from "./launch-journal";
import { LaunchSpecError } from "./launch-spec";
import { transitionJournal } from "./journal-transitions";

type Code =
  | "journal_invalid"
  | "journal_conflict"
  | "journal_capacity"
  | "journal_busy"
  | "journal_locked"
  | "journal_recovery_required"
  | "journal_durability_unknown"
  | "journal_closed"
  | "capability_unavailable";
export class JournalStoreError extends Error {
  readonly name = "JournalStoreError";
  constructor(readonly code: Code) {
    super(code);
  }
}
export function journalFailure(error: unknown): JournalStoreError {
  if (error instanceof JournalStoreError) return error;
  if (error instanceof JournalEventError || error instanceof LaunchSpecError)
    return new JournalStoreError("journal_invalid");
  if (error instanceof LaunchJournalError) return new JournalStoreError("journal_conflict");
  if (
    error instanceof JournalFileError ||
    error instanceof JournalLayoutError ||
    error instanceof JournalLockError
  ) {
    switch (error.code) {
      case "inventory_busy":
      case "journal_busy":
      case "journal_lock_busy":
        return new JournalStoreError("journal_busy");
      case "journal_locked":
        return new JournalStoreError("journal_locked");
      case "journal_capacity":
        return new JournalStoreError("journal_capacity");
      case "journal_conflict":
        return new JournalStoreError("journal_conflict");
      case "journal_closed":
      case "journal_lock_closed":
        return new JournalStoreError("journal_closed");
      case "capability_unavailable":
        return new JournalStoreError("capability_unavailable");
      case "journal_durability_unknown":
        return new JournalStoreError("journal_durability_unknown");
      default:
        return new JournalStoreError("journal_recovery_required");
    }
  }
  return new JournalStoreError("journal_recovery_required");
}
const fatal = (error: JournalStoreError) =>
  ["journal_recovery_required", "journal_durability_unknown", "capability_unavailable"].includes(
    error.code,
  );
type Call = {
  start(): Promise<void>;
  reject(error: JournalStoreError): void;
  timer: ReturnType<typeof setTimeout>;
  deadline: number;
};
// Journal-only serialization shared by admission and receipt ownership. This does not
// substitute for any platform, filesystem or cross-process lock verification.
export function createJournalCallQueue(cleanup: () => Promise<void>) {
  const waiting: Call[] = [],
    settled = Promise.withResolvers<void>();
  let active: Call | undefined,
    sealed = false,
    poison: JournalStoreError | undefined,
    cleaning = false;
  void settled.promise.catch(() => {});
  function rejectWaiting(error: JournalStoreError) {
    for (const call of waiting.splice(0)) {
      clearTimeout(call.timer);
      call.reject(error);
    }
  }
  function finish() {
    if (!sealed || active || cleaning) return;
    cleaning = true;
    void Promise.resolve()
      .then(cleanup)
      .then(settled.resolve, () =>
        settled.reject(new JournalStoreError("journal_durability_unknown")),
      );
  }
  function deny(error: JournalStoreError) {
    poison = error;
    sealed = true;
    rejectWaiting(error);
    finish();
  }
  function pump() {
    if (active || sealed) {
      finish();
      return;
    }
    const call = waiting.shift();
    if (!call) return;
    if (performance.now() >= call.deadline) {
      clearTimeout(call.timer);
      call.reject(new JournalStoreError("journal_busy"));
      pump();
      return;
    }
    active = call;
    void call.start().finally(() => {
      clearTimeout(call.timer);
      active = undefined;
      pump();
    });
  }
  return Object.freeze({
    settled: settled.promise,
    run<T>(capture: () => (check: () => void) => Promise<T>): Promise<T> {
      if (sealed) return Promise.reject(poison ?? new JournalStoreError("journal_closed"));
      if (waiting.length + Number(active !== undefined) >= 32)
        return Promise.reject(new JournalStoreError("journal_busy"));
      const deadline = performance.now() + 5000;
      let work: (check: () => void) => Promise<T>;
      try {
        work = capture();
      } catch (error) {
        return Promise.reject(journalFailure(error));
      }
      const response = Promise.withResolvers<T>();
      const check = () => {
        if (poison) throw poison;
        if (sealed) throw new JournalStoreError("journal_closed");
        if (performance.now() >= deadline) {
          const error = new JournalStoreError("journal_durability_unknown");
          deny(error);
          throw error;
        }
      };
      const call: Call = {
        deadline,
        reject: response.reject,
        timer: setTimeout(
          () => {
            if (active === call) {
              const error = new JournalStoreError("journal_durability_unknown");
              response.reject(error);
              deny(error);
            } else {
              const index = waiting.indexOf(call);
              if (index !== -1) {
                waiting.splice(index, 1);
                response.reject(new JournalStoreError("journal_busy"));
              }
            }
          },
          Math.max(0, deadline - performance.now()),
        ),
        async start() {
          try {
            check();
            const result = await work(check);
            check();
            response.resolve(result);
          } catch (error) {
            const fixed = journalFailure(error);
            response.reject(fixed);
            if (fatal(fixed)) deny(fixed);
          }
        },
      };
      waiting.push(call);
      pump();
      return response.promise;
    },
    close(): Promise<void> {
      sealed = true;
      rejectWaiting(poison ?? new JournalStoreError("journal_closed"));
      finish();
      return settled.promise;
    },
  });
}

export type JournalOwner = Readonly<{
  snapshot(): LaunchJournal;
  apply(event: unknown): Promise<LaunchJournal>;
  close(): Promise<void>;
  settled: Promise<void>;
}>;
type Options = JournalTrust & Readonly<{ root: string; uid: number }>;
// Transfers an already acquired receipt lock. On failure this function drains/closes it.
// No injectable platform or successful-lock substitute is accepted by the store.
export async function openJournalOwner(
  options: Options,
  lock: JournalLockOwner,
  suppliedFaults: JournalFileFaults = {},
): Promise<JournalOwner> {
  const { before, after, write } = suppliedFaults;
  const faults = Object.freeze({
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(write ? { write } : {}),
  });
  let layout: Awaited<ReturnType<typeof openJournalLayout>> | undefined,
    files: Awaited<ReturnType<typeof openJournalFiles>> | undefined;
  async function cleanup() {
    try {
      await files?.close();
    } finally {
      try {
        await layout?.close();
      } finally {
        await lock.close();
      }
    }
  }
  try {
    layout = await openJournalLayout(options);
    await layout.verifyLinuxProfile();
    await lock.recheck();
    await layout.inspectReceipt(options.receiptId, "idle");
    files = await openJournalFiles(options, faults);
    let current = await files.read();
    await lock.recheck();
    const heldLayout = layout,
      heldFiles = files,
      queue = createJournalCallQueue(cleanup);
    return Object.freeze({
      snapshot: () => current,
      settled: queue.settled,
      close: queue.close,
      apply(raw: unknown) {
        return queue.run(() => {
          const event = parseJournalEvent(raw);
          return async (check) => {
            await heldLayout.verifyLinuxProfile();
            check();
            await lock.recheck();
            check();
            await heldLayout.inspectReceipt(options.receiptId, "idle");
            check();
            const observed = await heldFiles.read();
            check();
            if (!encodeJournal(observed, options).equals(encodeJournal(current, options)))
              throw new JournalStoreError("journal_recovery_required");
            const next = parseLaunchJournal(transitionJournal(current, event).record, options);
            if (!encodeJournal(current, options).equals(encodeJournal(next, options))) {
              await heldFiles.commit(current, next);
              check();
            }
            await lock.recheck();
            check();
            current = next;
            return current;
          };
        });
      },
    });
  } catch (error) {
    try {
      await cleanup();
    } catch {
      throw new JournalStoreError("journal_durability_unknown");
    }
    throw journalFailure(error);
  }
}

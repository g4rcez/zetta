import { journalDigest, LaunchJournalError, parseJournalOperation } from "./launch-journal";
import type { JournalOperation, LaunchJournal } from "./launch-journal";

type Owner = Readonly<{ receiptId: string; attemptId: string; leaseId: string; fence: number }>;
type OwnedFact = Readonly<{ type: "created_verified" | "started" | "input_written" | "stopped" | "removed"; containerId: string; containerName: string; ownershipLabel: string; identityDigest: string }>;
type EventScope = Readonly<{ owner: Owner; atEpochMs: number }>;
export type JournalEvent = EventScope & (
  | Readonly<{ type: "begin"; operation: JournalOperation }>
  | Readonly<{ type: "ack"; operationId: string; operationSequence: number; fact: OwnedFact }>
  | Readonly<{ type: "unknown"; operationId: string; operationSequence: number }>
  | Readonly<{ type: "absent" }>
  | Readonly<{ type: "cancel"; reason: NonNullable<LaunchJournal["cancelIntent"]> }>
);
export type JournalDraft = Readonly<{ record: LaunchJournal; effect: JournalOperation | null }>;
type State = Pick<LaunchJournal, "containerId" | "phase" | "pendingOperation" | "lastOperation" | "operationSequence" | "cancelIntent" | "lastInput" | "inputBytes" | "terminal" | "cleanup" | "outcomeUncertain" | "observedAtEpochMs">;
const draft = (record: LaunchJournal, effect: JournalOperation | null = null): JournalDraft => Object.freeze({ record, effect });
const update = (record: LaunchJournal, state: Partial<State>): LaunchJournal => Object.freeze({ ...record, ...state });
const equalOperation = (a: JournalOperation, b: JournalOperation) => journalDigest([a.id, a.sequence, a.type, a.input]) === journalDigest([b.id, b.sequence, b.type, b.input]);

function begin(record: LaunchJournal, event: Extract<JournalEvent, { type: "begin" }>): JournalDraft {
  const op = parseJournalOperation(event.operation), existing = record.pendingOperation ?? record.lastOperation?.operation;
  if (existing && op.id === existing.id) {
    if (!equalOperation(existing, op)) throw new LaunchJournalError("operation_conflict");
    return draft(record);
  }
  if (record.pendingOperation !== null || op.sequence !== record.operationSequence + 1) throw new LaunchJournalError("operation_conflict");
  const base = { pendingOperation: op, operationSequence: op.sequence, observedAtEpochMs: event.atEpochMs };
  switch (op.type) {
    case "create":
    case "start":
    case "input": {
      if (record.cancelIntent !== null || record.outcomeUncertain || record.terminal !== "none" || event.atEpochMs >= record.spec.deadlineEpochMs) throw new LaunchJournalError("admission_closed");
      switch (op.type) {
        case "create":
          if (record.phase !== "intent") throw new LaunchJournalError("invalid_transition");
          return draft(update(record, { ...base, phase: "creating" }), op);
        case "start":
          if (record.phase !== "prepared") throw new LaunchJournalError("invalid_transition");
          return draft(update(record, { ...base, phase: "starting" }), op);
        case "input": {
          const input = op.input;
          if (record.phase !== "running" || input === null || record.lastInput?.eof) throw new LaunchJournalError("admission_closed");
          if (input.sequence !== (record.lastInput?.sequence ?? 0) + 1 || input.id === record.lastInput?.id
            || (!input.eof && input.byteLength === 0) || input.byteLength > record.spec.budgets.maxFrameBytes
            || record.inputBytes + input.byteLength > record.spec.budgets.maxInputBytes) throw new LaunchJournalError("invalid_operation");
          return draft(update(record, { ...base, lastInput: input, inputBytes: record.inputBytes + input.byteLength }), op);
        }
        default: return unreachable(op.type);
      }
    }
    case "stop":
      if (record.cancelIntent === null || record.containerId === null || record.terminal !== "none" || record.cleanup === "confirmed") throw new LaunchJournalError("invalid_transition");
      return draft(update(record, { ...base, phase: "stopping" }), op);
    case "remove":
      if (record.containerId === null || record.terminal !== "process_stopped" || record.cleanup === "confirmed") throw new LaunchJournalError("invalid_transition");
      return draft(update(record, { ...base, phase: "stopped" }), op);
    default: return unreachable(op.type);
  }
}

function acknowledge(record: LaunchJournal, event: Extract<JournalEvent, { type: "ack" }>): JournalDraft {
  const fact = event.fact;
  if (!/^[a-f0-9]{64}$/.test(fact.containerId) || fact.containerName !== record.containerName || fact.ownershipLabel !== record.ownershipLabel
    || fact.identityDigest !== record.identityDigest || (record.containerId !== null && fact.containerId !== record.containerId)) throw new LaunchJournalError("identity_mismatch");
  const factDigest = journalDigest([fact.type, fact.containerId, fact.containerName, fact.ownershipLabel, fact.identityDigest]);
  const last = record.lastOperation;
  if (last?.operation.id === event.operationId && last.operation.sequence === event.operationSequence) {
    if (last.factDigest !== factDigest) throw new LaunchJournalError("operation_conflict");
    return draft(record);
  }
  const op = record.pendingOperation;
  if (op === null || op.id !== event.operationId || op.sequence !== event.operationSequence) throw new LaunchJournalError("operation_conflict");
  const expected = { create: "created_verified", start: "started", input: "input_written", stop: "stopped", remove: "removed" } as const;
  if (fact.type !== expected[op.type]) throw new LaunchJournalError("operation_conflict");
  const cancelIntent = record.cancelIntent ?? (event.atEpochMs >= record.spec.deadlineEpochMs ? "deadline" : null);
  const base = { pendingOperation: null, lastOperation: Object.freeze({ operation: op, factDigest }), containerId: fact.containerId, cancelIntent, observedAtEpochMs: event.atEpochMs };
  const activePhase = record.outcomeUncertain ? "quarantined" : cancelIntent === null ? null : "stopping";
  switch (op.type) {
    case "create": return draft(update(record, { ...base, phase: activePhase ?? "prepared" }));
    case "start":
    case "input": return draft(update(record, { ...base, phase: activePhase ?? "running" }));
    case "stop": return draft(update(record, { ...base, phase: "stopped", terminal: "process_stopped", cleanup: "pending" }));
    case "remove": return draft(update(record, { ...base, phase: "stopped", cleanup: "confirmed" }));
    default: return unreachable(op.type);
  }
}

// Internal backend facts only. Commit the returned record durably before issuing its effect.
export function transitionJournal(record: LaunchJournal, event: JournalEvent): JournalDraft {
  const owner = event.owner;
  if (owner.receiptId !== record.receiptId || owner.attemptId !== record.spec.context.attemptId || owner.leaseId !== record.spec.leaseId || owner.fence !== record.spec.fence) throw new LaunchJournalError("identity_mismatch");
  if (!Number.isSafeInteger(event.atEpochMs) || event.atEpochMs < record.observedAtEpochMs) throw new LaunchJournalError("clock_denied");
  switch (event.type) {
    case "begin": return begin(record, event);
    case "ack": return acknowledge(record, event);
    case "unknown": {
      const pending = record.pendingOperation;
      if (pending === null || pending.id !== event.operationId || pending.sequence !== event.operationSequence) throw new LaunchJournalError("operation_conflict");
      return draft(update(record, { phase: "quarantined", cancelIntent: record.cancelIntent ?? "recovery", outcomeUncertain: true, cleanup: "unknown", observedAtEpochMs: event.atEpochMs }));
    }
    case "absent":
      if (record.cleanup === "confirmed") return draft(record);
      return draft(update(record, { phase: "quarantined", cancelIntent: record.cancelIntent ?? "recovery", outcomeUncertain: true, cleanup: "unknown", observedAtEpochMs: event.atEpochMs }));
    case "cancel":
      if (event.reason === "deadline" && event.atEpochMs < record.spec.deadlineEpochMs) throw new LaunchJournalError("clock_denied");
      if (record.cancelIntent !== null) return draft(record);
      if (record.phase === "intent") return draft(update(record, { cancelIntent: event.reason, phase: "stopped", terminal: "not_started", cleanup: "confirmed", observedAtEpochMs: event.atEpochMs }));
      return draft(update(record, { cancelIntent: event.reason, phase: record.containerId === null ? record.phase : "stopping", observedAtEpochMs: event.atEpochMs }));
    default: return unreachable(event);
  }
}

function unreachable(_value: never): never { throw new LaunchJournalError("invalid_transition"); }

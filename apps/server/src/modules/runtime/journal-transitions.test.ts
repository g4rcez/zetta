import { uuidv7 } from "@zetta/core/uuid";
import { expect, test } from "bun:test";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";
import { parseLaunchSpec } from "./launch-spec";
import { createLaunchJournal, parseLaunchJournal } from "./launch-journal";
import type { JournalOperation, LaunchJournal } from "./launch-journal";
import { transitionJournal } from "./journal-transitions";
import type { JournalEvent } from "./journal-transitions";

const policy = createFixtureLaunchPolicy({ installationId: "install-a", policyVersion: "fixture-policy-2", image: `sha256:${"1".repeat(64)}` });
const admission = { nowEpochMs: 1000, authorizedDeadlineEpochMs: 31_000, policyVersion: policy.policyVersion };
const fresh = () => createLaunchJournal(expandFixtureRecipe(parseLaunchSpec({ version: 1,
  context: { actorId: "actor-a", runId: "run-a", attemptId: "attempt-a", botId: "bot-a", conversationId: "chat-a", configurationId: "config-a" },
  leaseId: "lease-a", fence: 1, recipe: "fixture-v1", fixtureCase: "echo", policyVersion: policy.policyVersion, deadlineEpochMs: 31_000,
  budgets: { deadlineMs: 30_000, maxInputBytes: 32, maxOutputBytes: 1024, maxFrameBytes: 16 },
}, admission), policy), admission);
const owner = (r: LaunchJournal) => ({ receiptId: r.receiptId, attemptId: r.spec.context.attemptId, leaseId: r.spec.leaseId, fence: r.spec.fence });
const operation = (r: LaunchJournal, type: JournalOperation["type"], input: JournalOperation["input"] = null): JournalOperation => ({ id: uuidv7(), sequence: r.operationSequence + 1, type, input });
const begin = (r: LaunchJournal, op: JournalOperation) => transitionJournal(r, { type: "begin", owner: owner(r), atEpochMs: 1000, operation: op });
const fact = (r: LaunchJournal, type: "created_verified" | "started" | "input_written" | "stopped" | "removed") => ({ type, containerId: r.containerId ?? "a".repeat(64), containerName: r.containerName, ownershipLabel: r.ownershipLabel, identityDigest: r.identityDigest });
const ackEvent = (r: LaunchJournal, op: JournalOperation, type: "created_verified" | "started" | "input_written" | "stopped" | "removed"): JournalEvent => ({ type: "ack", owner: owner(r), atEpochMs: 1000, operationId: op.id, operationSequence: op.sequence, fact: fact(r, type) });
const prepared = () => { const r = fresh(), op = operation(r, "create"); return transitionJournal(begin(r, op).record, ackEvent(r, op, "created_verified")).record; };
const running = () => { const r = prepared(), op = operation(r, "start"); return transitionJournal(begin(r, op).record, ackEvent(r, op, "started")).record; };
const cancelled = () => { const r = running(); return transitionJournal(r, { type: "cancel", owner: owner(r), atEpochMs: 1000, reason: "owner" }).record; };
const stopped = () => { const r = cancelled(), op = operation(r, "stop"); return transitionJournal(begin(r, op).record, ackEvent(r, op, "stopped")).record; };

test("returns an intent draft before an effect and makes exact replays inert", () => {
  // Given
  const r = fresh(), op = operation(r, "create");
  // When
  const draft = begin(r, op), replay = begin(draft.record, op);
  // Then
  expect(r.phase).toBe("intent");
  expect(draft.record.phase).toBe("creating");
  expect(draft.effect).toEqual(op);
  expect(replay.effect).toBeNull();
  expect(replay.record).toBe(draft.record);
});

test("unknown create and absence stay quarantined until matching late acknowledgement permits cleanup only", () => {
  // Given
  const r = fresh(), op = operation(r, "create"), creating = begin(r, op).record;
  const uncertain = transitionJournal(creating, { type: "unknown", owner: owner(r), atEpochMs: 1000, operationId: op.id, operationSequence: op.sequence }).record;
  // When
  const absent = transitionJournal(uncertain, { type: "absent", owner: owner(r), atEpochMs: 1000 }).record;
  const late = transitionJournal(absent, ackEvent(r, op, "created_verified")).record;
  // Then
  expect(absent.pendingOperation).toEqual(op);
  expect(absent.cleanup).toBe("unknown");
  expect(late.phase).toBe("quarantined");
  expect(late.pendingOperation).toBeNull();
  expect(late.outcomeUncertain).toBe(true);
  expect(() => begin(late, operation(late, "start"))).toThrow("admission_closed");
  expect(begin(late, operation(late, "stop")).effect?.type).toBe("stop");
});

test("cancellation closes activation while a create acknowledgement is pending", () => {
  // Given
  const r = fresh(), op = operation(r, "create");
  const cancelled = transitionJournal(begin(r, op).record, { type: "cancel", owner: owner(r), atEpochMs: 1000, reason: "owner" }).record;
  // When
  const late = transitionJournal(cancelled, ackEvent(r, op, "created_verified")).record;
  // Then
  expect(late.cancelIntent).toBe("owner");
  expect(() => begin(late, operation(late, "start"))).toThrow("admission_closed");
});

test("stopped remains cleanup pending until acknowledged exact resource removal", () => {
  // Given
  const r = running(), cancelled = transitionJournal(r, { type: "cancel", owner: owner(r), atEpochMs: 1000, reason: "owner" }).record;
  const stop = operation(cancelled, "stop"), stopped = transitionJournal(begin(cancelled, stop).record, ackEvent(cancelled, stop, "stopped")).record;
  // When
  const remove = operation(stopped, "remove"), cleaned = transitionJournal(begin(stopped, remove).record, ackEvent(stopped, remove, "removed")).record;
  // Then
  expect(stopped.cleanup).toBe("pending");
  expect(cleaned.cleanup).toBe("confirmed");
  expect(cleaned.terminal).toBe("process_stopped");
  expect(() => begin(cleaned, operation(cleaned, "start"))).toThrow("admission_closed");
  expect(parseLaunchJournal(JSON.parse(JSON.stringify(cleaned)), { policy })).toEqual(cleaned);
});

test("unknown input closes delivery and a late acknowledgement cannot reopen or resend", () => {
  // Given
  const r = running(), op = operation(r, "input", { id: "input-a", sequence: 1, byteLength: 8, eof: false });
  const admitted = begin(r, op).record;
  // When
  const uncertain = transitionJournal(admitted, { type: "unknown", owner: owner(r), atEpochMs: 1000, operationId: op.id, operationSequence: op.sequence }).record;
  const late = transitionJournal(uncertain, ackEvent(r, op, "input_written")).record;
  // Then
  expect(begin(late, op).effect).toBeNull();
  expect(late.inputBytes).toBe(8);
  expect(late.lastInput?.sequence).toBe(1);
  expect(() => begin(late, operation(late, "input", { id: "input-b", sequence: 2, byteLength: 8, eof: false }))).toThrow("admission_closed");
});

for (const [type, make, factType] of [
  ["start", prepared, "started"], ["stop", cancelled, "stopped"], ["remove", stopped, "removed"],
] as const) test(`keeps unknown ${type} pending and allows only matching late facts`, () => {
  // Given
  const r = make(), op = operation(r, type), pending = begin(r, op).record;
  // When
  const unknown = transitionJournal(pending, { type: "unknown", owner: owner(r), atEpochMs: 1000, operationId: op.id, operationSequence: op.sequence }).record;
  const late = transitionJournal(unknown, ackEvent(r, op, factType)).record;
  // Then
  expect(unknown.phase).toBe("quarantined");
  expect(unknown.pendingOperation).toEqual(op);
  expect(unknown.cleanup).toBe("unknown");
  expect(() => begin(unknown, operation(unknown, "remove"))).toThrow("operation_conflict");
  expect(late.outcomeUncertain).toBe(true);
  expect(late.cleanup).toBe(type === "remove" ? "confirmed" : type === "stop" ? "pending" : "unknown");
  expect(parseLaunchJournal(JSON.parse(JSON.stringify(unknown)), { policy })).toEqual(unknown);
  expect(parseLaunchJournal(JSON.parse(JSON.stringify(late)), { policy })).toEqual(late);
});

for (const change of [{ receiptId: "foreign" }, { attemptId: "foreign" }, { leaseId: "foreign" }, { fence: 2 }]) test("rejects stale or foreign ownership before admitting a daemon effect", () => {
  // Given
  const r = prepared();
  // When
  const invoke = () => transitionJournal(r, { type: "begin", owner: { ...owner(r), ...change }, atEpochMs: 1000, operation: operation(r, "start") });
  // Then
  expect(invoke).toThrow("identity_mismatch");
  expect(r.pendingOperation).toBeNull();
});

for (const change of [{ containerId: "partial" }, { containerId: "b".repeat(64) }, { containerName: "foreign" }, { ownershipLabel: "f".repeat(64) }, { identityDigest: "f".repeat(64) }]) test("rejects foreign resource facts without settling the operation", () => {
  // Given
  const r = prepared(), op = operation(r, "start"), pending = begin(r, op).record;
  // When
  const invoke = () => transitionJournal(pending, { type: "ack", owner: owner(r), atEpochMs: 1000, operationId: op.id, operationSequence: op.sequence, fact: { ...fact(r, "started"), ...change } });
  // Then
  expect(invoke).toThrow("identity_mismatch");
  expect(pending.pendingOperation).toEqual(op);
});

test("makes exact acknowledged replay inert and rejects changed operation and fact", () => {
  // Given
  const r = fresh(), op = operation(r, "create"), event = ackEvent(r, op, "created_verified");
  const ready = transitionJournal(begin(r, op).record, event).record;
  // When
  const replay = transitionJournal(ready, event);
  // Then
  expect(replay.record).toBe(ready);
  expect(replay.effect).toBeNull();
  expect(begin(ready, op).effect).toBeNull();
  expect(() => begin(ready, { ...op, type: "start" })).toThrow("operation_conflict");
  expect(() => transitionJournal(ready, ackEvent(r, op, "started"))).toThrow("operation_conflict");
  expect(() => begin(ready, { ...operation(ready, "start"), sequence: 1 })).toThrow("operation_conflict");
});

test("rejects stale acknowledgement and unknown events rather than settling a different operation", () => {
  // Given
  const r = prepared(), op = operation(r, "start"), pending = begin(r, op).record;
  // When
  const wrong = operation(r, "start");
  // Then
  expect(() => transitionJournal(pending, ackEvent(r, wrong, "started"))).toThrow("operation_conflict");
  expect(() => transitionJournal(pending, { type: "unknown", owner: owner(r), atEpochMs: 1000, operationId: op.id, operationSequence: op.sequence + 1 })).toThrow("operation_conflict");
});

for (const input of [
  { id: "gap", sequence: 2, byteLength: 1, eof: false },
  { id: "large", sequence: 1, byteLength: 17, eof: false },
  { id: "empty", sequence: 1, byteLength: 0, eof: false },
]) test("rejects input sequence gaps and frame budget violations before bytes are admitted", () => {
  // Given
  const r = running();
  // When
  const invoke = () => begin(r, operation(r, "input", input));
  // Then
  expect(invoke).toThrow("invalid_operation");
  expect(r.inputBytes).toBe(0);
});

test("counts admitted input once and rejects repeated sequence, identity and aggregate overflow", () => {
  // Given
  let r = running();
  for (let sequence = 1; sequence <= 2; sequence++) {
    const op = operation(r, "input", { id: `input-${sequence}`, sequence, byteLength: 16, eof: false });
    r = transitionJournal(begin(r, op).record, ackEvent(r, op, "input_written")).record;
  }
  // When
  const invoke = (id: string, sequence: number, byteLength: number) => begin(r, operation(r, "input", { id, sequence, byteLength, eof: byteLength === 0 }));
  // Then
  expect(r.inputBytes).toBe(32);
  expect(() => invoke("input-3", 3, 1)).toThrow("invalid_operation");
  expect(() => invoke("input-3", 2, 0)).toThrow("invalid_operation");
  expect(() => invoke("input-2", 3, 0)).toThrow("invalid_operation");
  expect(parseLaunchJournal(JSON.parse(JSON.stringify(r)), { policy })).toEqual(r);
});

test("EOF admission closes the stream even after an acknowledged write", () => {
  // Given
  const r = running(), op = operation(r, "input", { id: "eof", sequence: 1, byteLength: 0, eof: true });
  const closed = transitionJournal(begin(r, op).record, ackEvent(r, op, "input_written")).record;
  // When
  const invoke = () => begin(closed, operation(closed, "input", { id: "later", sequence: 2, byteLength: 1, eof: false }));
  // Then
  expect(invoke).toThrow("admission_closed");
});

for (const atEpochMs of [999, NaN, Infinity, 31_000]) test("rejects backward invalid or expired admission clocks", () => {
  // Given
  const r = prepared();
  // When
  const invoke = () => transitionJournal(r, { type: "begin", owner: owner(r), atEpochMs, operation: operation(r, "start") });
  // Then
  expect(invoke).toThrow(atEpochMs === 31_000 ? "admission_closed" : "clock_denied");
  expect(r.spec.deadlineEpochMs).toBe(31_000);
});

test("a start acknowledgement after expiry closes admission and preserves the absolute deadline", () => {
  // Given
  const r = prepared(), op = operation(r, "start"), pending = begin(r, op).record;
  // When
  const late = transitionJournal(pending, { ...ackEvent(r, op, "started"), atEpochMs: 31_000 }).record;
  // Then
  expect(late.phase).toBe("stopping");
  expect(late.cancelIntent).toBe("deadline");
  expect(late.spec.deadlineEpochMs).toBe(31_000);
});

test("cancels unsubmitted intent into a not-started tombstone that refuses restart", () => {
  // Given
  const r = fresh();
  // When
  const tombstone = transitionJournal(r, { type: "cancel", owner: owner(r), atEpochMs: 1000, reason: "owner" });
  // Then
  expect(tombstone.effect).toBeNull();
  expect(tombstone.record.terminal).toBe("not_started");
  expect(tombstone.record.cleanup).toBe("confirmed");
  expect(() => begin(tombstone.record, operation(tombstone.record, "create"))).toThrow("admission_closed");
  expect(parseLaunchJournal(JSON.parse(JSON.stringify(tombstone.record)), { policy })).toEqual(tombstone.record);
});

test("rejects stored cleanup confirmation supported only by a stop acknowledgement", () => {
  // Given
  const r = stopped();
  // When
  const invoke = () => parseLaunchJournal({ ...r, cleanup: "confirmed" }, { policy });
  // Then
  expect(invoke).toThrow("invalid_journal");
});

test("rejects premature removal and an early deadline cancellation", () => {
  // Given
  const r = cancelled(), active = running();
  // When
  const remove = () => begin(r, operation(r, "remove"));
  // Then
  expect(remove).toThrow("invalid_transition");
  expect(() => transitionJournal(active, { type: "cancel", owner: owner(active), atEpochMs: 1000, reason: "deadline" })).toThrow("clock_denied");
});

test("copies pending operation metadata so caller mutation cannot change an admitted input", () => {
  // Given
  const r = running(), input = { id: "input", sequence: 1, byteLength: 8, eof: false };
  const source = { id: uuidv7(), sequence: 3, type: "input" as const, input };
  const admitted = begin(r, source);
  // When
  source.id = uuidv7();
  input.byteLength = 16;
  // Then
  expect(admitted.record.pendingOperation?.id).not.toBe(source.id);
  expect(admitted.record.lastInput?.byteLength).toBe(8);
  expect(Object.isFrozen(admitted.effect)).toBe(true);
  expect(Object.isFrozen(admitted.record.lastInput)).toBe(true);
});

import { expect, spyOn, test } from "bun:test";
import { parseJournalEvent } from "./journal-event";
import { createJournalCallQueue } from "./journal-owner";
const owner = { receiptId: "11111111-1111-4111-8111-111111111111", attemptId: "attempt", leaseId: "lease", fence: 1 };
test("closed events copy nested authority and deny extra payload fields", () => {
  const raw = { type: "cancel", owner: { ...owner }, atEpochMs: 1000, reason: "owner" };
  const parsed = parseJournalEvent(raw);
  raw.owner.attemptId = "changed";
  expect(parsed.owner.attemptId).toBe("attempt"); expect(Object.isFrozen(parsed.owner)).toBe(true);
  for (const bad of [{ ...raw, bytes: "secret" }, { ...raw, owner: { ...owner, admin: true } }, { ...raw, atEpochMs: NaN }]) {
    expect(() => parseJournalEvent(bad)).toThrow("journal_invalid");
  }
});
test("queue capacity rejects call33 before capture; close drains active work before cleanup", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let cleaned = false, captures = 0;
  const queue = createJournalCallQueue(async () => { cleaned = true; });
  const first = queue.run(() => async () => { entered.resolve(); await release.promise; return 1; });
  await entered.promise;
  const pending = Array.from({ length: 31 }, () => queue.run(() => { captures++; return async () => 2; }).catch(error => error.message));
  await expect(queue.run(() => { captures++; return async () => 3; })).rejects.toThrow("journal_busy");
  expect(captures).toBe(31);
  const closed = queue.close(); expect(cleaned).toBe(false);
  release.resolve(); await expect(first).rejects.toThrow("journal_closed"); await closed;
  expect(await Promise.all(pending)).toEqual(Array(31).fill("journal_closed")); expect(cleaned).toBe(true);
});

test("all event variants are closed, bounded and deeply copied", () => {
  const scope = { owner, atEpochMs: 1000 }, operationId = "22222222-2222-4222-8222-222222222222";
  const operation = { id: operationId, sequence: 3, type: "input", input: { id: "frame", sequence: 1, byteLength: 7, eof: false } };
  const begin = parseJournalEvent({ ...scope, type: "begin", operation });
  operation.input.byteLength = 9;
  if (begin.type !== "begin") throw new Error("wrong event");
  expect(begin.operation.input?.byteLength).toBe(7); expect(Object.isFrozen(begin.operation.input)).toBe(true);
  const fact = { type: "created_verified", containerId: "a".repeat(64), containerName: "name", ownershipLabel: "b".repeat(64), identityDigest: "c".repeat(64) };
  const ack = parseJournalEvent({ ...scope, type: "ack", operationId, operationSequence: 1, fact });
  fact.containerName = "changed";
  if (ack.type !== "ack") throw new Error("wrong event");
  expect(ack.fact.containerName).toBe("name"); expect(Object.isFrozen(ack.fact)).toBe(true);
  for (const event of [{ ...scope, type: "unknown", operationId, operationSequence: 1 }, { ...scope, type: "absent" },
    { ...scope, type: "cancel", reason: "recovery" }]) expect(Object.isFrozen(parseJournalEvent(event))).toBe(true);
  for (const bad of [{ ...scope, type: "unknown", operationId, operationSequence: 0 }, { ...scope, type: "cancel", reason: "retry" },
    { ...scope, type: "absent", owner: { ...owner, fence: 0 } }, { ...scope, type: "begin", operation: { ...operation, plaintext: "private" } },
    { ...scope, type: "ack", operationId, operationSequence: 1, fact: { ...fact, token: "private" } },
    { ...scope, type: "absent", atEpochMs: Number.MAX_SAFE_INTEGER + 1 }]) expect(() => parseJournalEvent(bad)).toThrow("journal_invalid");
});

test("FIFO work sees current state and invalid capture leaves queue usable", async () => {
  const queue = createJournalCallQueue(async () => {}), seen: number[] = [];
  await expect(queue.run(() => { throw new Error("private details"); })).rejects.toThrow("journal_recovery_required");
  const values = await Promise.all([1, 2, 3].map(value => queue.run(() => async () => { seen.push(value); return seen.length; })));
  expect(values).toEqual([1, 2, 3]); expect(seen).toEqual([1, 2, 3]); await queue.close();
});

test("started five-second timeout poisons immediately but retains work until real settlement", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let cleaned = false, published = false, nextStarted = false;
  const queue = createJournalCallQueue(async () => { cleaned = true; });
  const response = queue.run(() => async check => { entered.resolve(); await release.promise; check(); published = true; return 1; });
  await entered.promise;
  const queued = queue.run(() => async () => { nextStarted = true; return 2; }).catch(error => error.message);
  try {
    await expect(response).rejects.toThrow("journal_durability_unknown");
    expect(await queued).toBe("journal_durability_unknown");
    expect(cleaned).toBe(false); expect(published).toBe(false); expect(nextStarted).toBe(false);
    await expect(queue.run(() => async () => 3)).rejects.toThrow("journal_durability_unknown");
  } finally { release.resolve(); await queue.settled; }
  expect(cleaned).toBe(true); expect(published).toBe(false);
}, 10000);

test("cleanup failure is fixed unknown and never successful settlement", async () => {
  const queue = createJournalCallQueue(async () => { throw new Error("private cleanup detail"); });
  await expect(queue.close()).rejects.toThrow("journal_durability_unknown");
  await expect(queue.settled).rejects.toThrow("journal_durability_unknown");
});

test("started corruption poisons queued calls and settles cleanup without exposing cause", async () => {
  const gate = Promise.withResolvers<void>(); let cleaned = false, next = false;
  const queue = createJournalCallQueue(async () => { cleaned = true; });
  const first = queue.run(() => async () => { await gate.promise; throw new Error("private path and content"); }).catch(error => error);
  const second = queue.run(() => async () => { next = true; }).catch(error => error);
  gate.resolve();
  const failure = await first;
  expect(failure.message).toBe("journal_recovery_required"); expect("cause" in failure).toBe(false);
  expect(JSON.stringify(failure)).not.toContain("private"); expect((await second).message).toBe("journal_recovery_required");
  await queue.settled; expect(cleaned).toBe(true); expect(next).toBe(false);
});

test("unstarted call whose admission budget elapsed is dropped without poison or execution", async () => {
  const queue = createJournalCallQueue(async () => {}); let started = false;
  const clock = spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(6000);
  try {
    await expect(queue.run(() => async () => { started = true; })).rejects.toThrow("journal_busy");
  } finally { clock.mockRestore(); }
  expect(started).toBe(false);
  expect(await queue.run(() => async () => "usable")).toBe("usable"); await queue.close();
});

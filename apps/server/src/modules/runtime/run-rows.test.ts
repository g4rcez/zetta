import { expect, test } from "bun:test";
import { canonicalRunInput } from "./run-contract";
import { readRunRows, readRunResult, runProjection } from "./run-rows";
import { transitionRun } from "./run-state";
const id = "00000000-0000-4000-8000-000000000001",
  attemptId = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const input = {
    requestKey: id,
    origin: "interactive",
    botId: "bot",
    conversationId: "conversation",
    configurationId: "config",
    configurationVersion: 1,
    input: {
      prompt: "private é",
      harness: "fixture",
      connections: [],
      model: null,
      resumeReference: null,
      budgets: {
        deadlineMs: 1000,
        maxEvents: 3,
        maxOutputBytes: 1000,
        maxToolBytes: 100,
        maxToolCalls: 0,
      },
    },
  };
  const run = {
    id,
    ownerUserId: "owner",
    requestKey: id,
    originKind: "interactive",
    botId: "bot",
    conversationId: "conversation",
    configurationId: "config",
    configurationVersion: 1,
    inputVersion: 1,
    inputSnapshot: canonicalRunInput(input),
    createdAt: new Date(1),
    revision: 1,
    status: "queued",
    currentGeneration: 1,
    cancelRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    producerKind: null,
    producerVersion: null,
    actorActivationRevision: null,
  };
  const attempt = {
    id: attemptId,
    runId: id,
    ownerUserId: "owner",
    generation: 1,
    createdAt: new Date(1),
    status: "queued",
    effectState: "no_effect",
    leaseId: null,
    leaseExpiresAt: null,
    claimedAt: null,
    startedAt: null,
    finishedAt: null,
    stopConfirmedAt: null,
    resultVersion: null,
    resultText: null,
    resultErrorCode: null,
    resultLastSequence: null,
    cancellationReason: null,
  };
  return { run, attempt };
}
test("actual row parser projects only safe immutable DTO fields", () => {
  const { run, attempt } = fixture(),
    parsed = readRunRows(run, attempt);
  expect(parsed.dto).toEqual({
    id,
    revision: 1,
    origin: "interactive",
    botId: "bot",
    conversationId: "conversation",
    configurationId: "config",
    configurationVersion: 1,
    status: "queued",
    attemptId,
    generation: 1,
    effectState: "no_effect",
    createdAtMs: 1,
    startedAtMs: null,
    finishedAtMs: null,
    cancelRequestedAtMs: null,
  });
  expect(JSON.stringify(parsed.dto)).not.toMatch(/private|owner|lease|Snapshot|requestKey/);
  for (const value of [
    parsed,
    parsed.run,
    parsed.attempt,
    parsed.input,
    parsed.input.input,
    parsed.state,
    parsed.dto,
  ])
    expect(Object.isFrozen(value)).toBe(true);
});
test("stored provenance is exact frozen private data and never changes canonical input or safe output", () => {
  const { run, attempt } = fixture(),
    legacy = readRunRows(run, attempt);
  expect([
    legacy.run.producerKind,
    legacy.run.producerVersion,
    legacy.run.actorActivationRevision,
  ]).toEqual([null, null, null]);
  for (const actorActivationRevision of [1, 2147483647]) {
    const stamped = {
      ...run,
      producerKind: "fixture",
      producerVersion: 1,
      actorActivationRevision,
    };
    const parsed = readRunRows(stamped, attempt);
    expect([
      parsed.run.producerKind,
      parsed.run.producerVersion,
      parsed.run.actorActivationRevision,
    ]).toEqual(["fixture", 1, actorActivationRevision]);
    expect(Object.isFrozen(parsed.run)).toBe(true);
    stamped.actorActivationRevision = 7;
    expect(parsed.run.actorActivationRevision).toBe(actorActivationRevision);
    expect(parsed.run.inputSnapshot).toBe(run.inputSnapshot);
    expect(canonicalRunInput(parsed.input)).toBe(run.inputSnapshot);
    expect(parsed.dto).toEqual(legacy.dto);
    expect(parsed.state).toEqual(legacy.state);
    expect(Object.keys(parsed).sort()).toEqual(["attempt", "dto", "input", "run", "state"]);
    for (const output of [parsed.dto, parsed.input, parsed.state, runProjection(parsed.state)]) {
      expect(JSON.stringify(output)).not.toMatch(
        /producerKind|producerVersion|actorActivationRevision|eligible|authority/,
      );
    }
  }
});
test("required provenance rejects missing, partial and malformed tuples without normalizing storage", () => {
  const { run, attempt } = fixture();
  const fields = ["producerKind", "producerVersion", "actorActivationRevision"] as const;
  for (const field of fields) {
    const missing = Object.fromEntries(Object.entries(run).filter(([key]) => key !== field));
    expect(() => readRunRows(missing, attempt)).toThrow(/^storage_unavailable$/);
    expect(() => readRunRows({ ...run, [field]: undefined }, attempt)).toThrow(
      /^storage_unavailable$/,
    );
  }
  for (let mask = 1; mask < 7; mask += 1) {
    const partial = {
      ...run,
      producerKind: mask & 1 ? "fixture" : null,
      producerVersion: mask & 2 ? 1 : null,
      actorActivationRevision: mask & 4 ? 1 : null,
    };
    expect(() => readRunRows(partial, attempt)).toThrow(/^storage_unavailable$/);
  }
  const stamped = {
    ...run,
    producerKind: "fixture",
    producerVersion: 1,
    actorActivationRevision: 1,
  };
  for (const patch of [
    { producerKind: "native" },
    { producerKind: "Fixture" },
    { producerKind: 1 },
    { producerKind: {} },
    { producerVersion: 0 },
    { producerVersion: 2 },
    { producerVersion: "1" },
    { producerVersion: 1.5 },
    ...[0, -1, 1.5, 2147483648, NaN, Infinity, "1", true, {}].map((actorActivationRevision) => ({
      actorActivationRevision,
    })),
    { producerEligible: true },
  ]) {
    expect(() => readRunRows({ ...stamped, ...patch }, attempt)).toThrow(/^storage_unavailable$/);
  }
});
test("current and historical results validate provenance while retaining their existing public shape", () => {
  const { run, attempt } = fixture();
  const terminal = { ...attempt, status: "cancelled", finishedAt: new Date(2) };
  const expected = {
    runId: id,
    attemptId,
    generation: 1,
    status: "cancelled",
    effectState: "no_effect",
    finishedAtMs: 2,
    result: null,
  } as const;
  for (const provenance of [
    { producerKind: null, producerVersion: null, actorActivationRevision: null },
    { producerKind: "fixture", producerVersion: 1, actorActivationRevision: 2 },
  ]) {
    const stamped = { ...run, ...provenance };
    for (const source of [
      { ...stamped, status: "cancelled", finishedAt: new Date(2) },
      { ...stamped, currentGeneration: 2 },
    ]) {
      expect(readRunResult(source, terminal)).toEqual(expected);
      expect(() => readRunResult({ ...source, producerVersion: undefined }, terminal)).toThrow(
        /^storage_unavailable$/,
      );
      expect(() => readRunResult({ ...source, actorActivationRevision: 0 }, terminal)).toThrow(
        /^storage_unavailable$/,
      );
    }
  }
});
test("row parser rejects date, linkage, immutable snapshot and projection corruption", () => {
  const { run, attempt } = fixture();
  for (const patch of [
    { createdAt: null },
    { createdAt: new Date(NaN) },
    { createdAt: Infinity },
    { createdAt: "2026-01-01" },
    { botId: "changed" },
    { requestKey: attemptId },
    { configurationVersion: 2 },
    { inputVersion: 2 },
    { inputSnapshot: run.inputSnapshot + " " },
    { inputSnapshot: "[]" },
    { unexpected: true },
    { currentGeneration: 2 },
    { status: "running" },
  ]) {
    expect(() => readRunRows({ ...run, ...patch }, attempt)).toThrow("storage_unavailable");
  }
  for (const patch of [
    { ownerUserId: "other" },
    { runId: attemptId },
    { generation: 2 },
    { status: "running" },
    { effectState: "known" },
    { createdAt: new Date(0) },
    { finishedAt: new Date(2) },
    { resultText: "partial" },
    { stopConfirmedAt: new Date(2) },
    { cancellationReason: "owner_requested" },
  ]) {
    expect(() => readRunRows(run, { ...attempt, ...patch })).toThrow("storage_unavailable");
  }
});
test("projection contains only mutable lifecycle columns and preserves normalized terminal replay", () => {
  const { run, attempt } = fixture(),
    { state } = readRunRows(run, attempt);
  const token = { runId: id, attemptId, generation: 1, leaseId: null, expectedRevision: 1 };
  const next = transitionRun(state, token, { type: "cancel", atMs: 2 }),
    patch = runProjection(next);
  for (const value of [patch, patch.run, patch.attempt]) expect(Object.isFrozen(value)).toBe(true);
  expect(Object.keys(patch.run).sort()).toEqual([
    "cancelRequestedAt",
    "finishedAt",
    "revision",
    "startedAt",
    "status",
  ]);
  expect(Object.keys(patch.attempt).sort()).toEqual([
    "cancellationReason",
    "claimedAt",
    "effectState",
    "finishedAt",
    "leaseExpiresAt",
    "leaseId",
    "resultErrorCode",
    "resultLastSequence",
    "resultText",
    "resultVersion",
    "startedAt",
    "status",
    "stopConfirmedAt",
  ]);
  expect(readRunRows({ ...run, ...patch.run }, { ...attempt, ...patch.attempt }).dto.status).toBe(
    "cancelled",
  );
  expect(runProjection(transitionRun(next, token, { type: "cancel", atMs: 99 }))).toEqual(patch);
});
test("terminal result binds full owner/run identity and stored input event budget", () => {
  const { run, attempt } = fixture();
  const terminal = {
    ...attempt,
    status: "succeeded",
    effectState: "known",
    leaseId: id,
    claimedAt: new Date(1),
    leaseExpiresAt: new Date(10),
    startedAt: new Date(2),
    finishedAt: new Date(3),
    resultVersion: 1,
    resultText: "safe output",
    resultErrorCode: null,
    resultLastSequence: 3,
  };
  const done = { ...run, status: "succeeded", startedAt: new Date(2), finishedAt: new Date(3) };
  expect(readRunResult(done, terminal).result?.text).toBe("safe output");
  expect(() => readRunResult(done, { ...terminal, resultLastSequence: 4 })).toThrow(
    "storage_unavailable",
  );
  expect(() => readRunResult(done, { ...terminal, ownerUserId: "other" })).toThrow(
    "storage_unavailable",
  );
  expect(() => readRunResult(done, { ...terminal, resultVersion: null })).toThrow(
    "storage_unavailable",
  );
  expect(() => readRunResult(done, { ...terminal, claimedAt: null })).toThrow(
    "storage_unavailable",
  );
  expect(() => readRunResult(done, { ...terminal, stopConfirmedAt: new Date(0) })).toThrow(
    "storage_unavailable",
  );
  const historicalRun = {
    ...done,
    currentGeneration: 2,
    status: "queued",
    startedAt: null,
    finishedAt: null,
  };
  expect(readRunResult(historicalRun, terminal).generation).toBe(1);
  expect(() =>
    readRunResult({ ...historicalRun, currentGeneration: 1 }, { ...terminal, generation: 2 }),
  ).toThrow("storage_unavailable");
});

test("valid queued and running result reads are pending while malformed pending rows fail closed", () => {
  const { run, attempt } = fixture();
  expect(() => readRunResult(run, attempt)).toThrow("result_pending");
  const running = {
    ...attempt,
    status: "running",
    leaseId: id,
    claimedAt: new Date(1),
    leaseExpiresAt: new Date(10),
  };
  expect(() => readRunResult({ ...run, status: "running" }, running)).toThrow("result_pending");
  expect(() =>
    readRunResult({ ...run, status: "running" }, { ...running, resultText: "partial" }),
  ).toThrow("storage_unavailable");
});

test("current state validates stop facts and intent independently without leaking them", () => {
  const { run, attempt } = fixture();
  const running = {
    ...attempt,
    status: "running",
    leaseId: id,
    claimedAt: new Date(1),
    leaseExpiresAt: new Date(10),
    stopConfirmedAt: new Date(2),
  };
  expect(readRunRows({ ...run, status: "running" }, running).dto.status).toBe("running");
  expect(() =>
    readRunRows({ ...run, status: "running", cancelRequestedAt: new Date(2) }, running),
  ).toThrow("storage_unavailable");
  expect(
    readRunRows(
      { ...run, status: "running", cancelRequestedAt: new Date(2) },
      { ...running, cancellationReason: "owner_requested" },
    ).state.stopConfirmedAtMs,
  ).toBe(2);
});

test("historical cancellation uses its own lease/result/stop facts without current intent", () => {
  const { run, attempt } = fixture();
  const currentRun = { ...run, currentGeneration: 2 };
  const old = {
    ...attempt,
    status: "cancelled",
    effectState: "uncertain",
    cancellationReason: "owner_requested",
    leaseId: id,
    claimedAt: new Date(1),
    leaseExpiresAt: new Date(10),
    startedAt: new Date(2),
    finishedAt: new Date(3),
    stopConfirmedAt: new Date(4),
  };
  expect(readRunResult(currentRun, old)).toEqual({
    runId: id,
    attemptId,
    generation: 1,
    status: "cancelled",
    effectState: "uncertain",
    finishedAtMs: 3,
    result: null,
  });
  for (const patch of [
    { claimedAt: null },
    { leaseExpiresAt: new Date(1) },
    { finishedAt: new Date(0) },
    { stopConfirmedAt: new Date(1) },
    { cancellationReason: "unknown" },
    { effectState: "no_effect" },
  ]) {
    expect(() => readRunResult(currentRun, { ...old, ...patch })).toThrow("storage_unavailable");
  }
});
test("no-admission terminal projection round-trips owner intent and backend absence without stop or result", () => {
  for (const ownerIntent of [false, true])
    for (const provenance of [
      { producerKind: null, producerVersion: null, actorActivationRevision: null },
      { producerKind: "fixture", producerVersion: 1, actorActivationRevision: 3 },
    ] as const) {
      const f = fixture(),
        run = { ...f.run, ...provenance },
        attempt = f.attempt;
      const initial = readRunRows(run, attempt).state;
      const token = (s: typeof initial) => ({
        runId: s.runId,
        attemptId: s.attemptId,
        generation: s.generation,
        leaseId: s.leaseId,
        expectedRevision: s.revision,
      });
      const claimed = transitionRun(initial, token(initial), {
        type: "claimed",
        atMs: 2,
        leaseId: id,
        leaseExpiresAtMs: 10,
      });
      const source = ownerIntent
        ? transitionRun(claimed, token(claimed), { type: "cancel", atMs: 3 })
        : claimed;
      const terminal = transitionRun(source, token(source), {
        type: "cancelled_before_admission",
        atMs: 4,
      });
      const patch = runProjection(terminal),
        storedRun = { ...run, ...patch.run },
        storedAttempt = { ...attempt, ...patch.attempt };
      const reread = readRunRows(storedRun, storedAttempt);
      expect([
        reread.run.producerKind,
        reread.run.producerVersion,
        reread.run.actorActivationRevision,
      ]).toEqual([
        provenance.producerKind,
        provenance.producerVersion,
        provenance.actorActivationRevision,
      ]);
      expect(reread.state).toEqual(terminal);
      expect([
        reread.dto.status,
        reread.dto.effectState,
        reread.dto.finishedAtMs,
        reread.dto.cancelRequestedAtMs,
      ]).toEqual(["cancelled", "no_effect", 4, ownerIntent ? 3 : null]);
      expect([
        patch.attempt.resultVersion,
        patch.attempt.resultText,
        patch.attempt.resultErrorCode,
        patch.attempt.resultLastSequence,
        patch.attempt.stopConfirmedAt,
      ]).toEqual([null, null, null, null, null]);
      expect(readRunResult(storedRun, storedAttempt)).toEqual({
        runId: id,
        attemptId,
        generation: 1,
        status: "cancelled",
        effectState: "no_effect",
        finishedAtMs: 4,
        result: null,
      });
      expect(readRunResult({ ...run, currentGeneration: 2 }, storedAttempt).result).toBeNull();
      expect(
        runProjection(
          transitionRun(reread.state, token(source), {
            type: "cancelled_before_admission",
            atMs: 99,
          }),
        ),
      ).toEqual(patch);
    }
});

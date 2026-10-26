import { expect, test } from "bun:test";
import { parseRunState, transitionRun } from "./run-state";
import type { TerminalOutcome } from "./harness";

const id = "00000000-0000-4000-8000-000000000001";
const lease = "00000000-0000-4000-8000-000000000002";
const result = { version: 1, text: "done", errorCode: null, lastSequence: 3 };
function queued() { return parseRunState({ runId: id, attemptId: id, generation: 1, revision: 1, status: "queued", effectState: "no_effect",
  leaseId: null, leaseExpiresAtMs: null, createdAtMs: 1, claimedAtMs: null, startedAtMs: null, finishedAtMs: null,
  cancelRequestedAtMs: null, stopConfirmedAtMs: null, cancellationReason: null, result: null, maxEvents: 10 }); }
function running() { return transitionRun(queued(), { runId: id, attemptId: id, generation: 1, leaseId: null, expectedRevision: 1 },
  { type: "claimed", atMs: 2, leaseId: lease, leaseExpiresAtMs: 100 }); }
function token(state: ReturnType<typeof queued>) { return { runId: state.runId, attemptId: state.attemptId, generation: state.generation, leaseId: state.leaseId, expectedRevision: state.revision }; }
test("queued cancel never allocates lease or claims execution", () => {
  const state = queued();
  const next = transitionRun(state, token(state), { type: "cancel", atMs: 2 });
  expect([next.status, next.effectState, next.leaseId, next.finishedAtMs, next.stopConfirmedAtMs]).toEqual(["cancelled", "no_effect", null, 2, null]);
  expect(state.status).toBe("queued");
  expect(Object.isFrozen(next)).toBe(true);
});
test("claim is inert and admission is separate from claiming", () => {
  const state = running();
  expect([state.status, state.startedAtMs, state.effectState]).toEqual(["running", null, "no_effect"]);
  const next = transitionRun(state, token(state), { type: "admitted", atMs: 3 });
  expect(next.startedAtMs).toBe(3);
  expect(next.effectState).toBe("uncertain");
});
test("cancellation intent first wins completion without inventing stop proof", () => {
  const state = running();
  const cancelled = transitionRun(state, token(state), { type: "cancel", atMs: 3 });
  expect([cancelled.status, cancelled.finishedAtMs, cancelled.cancelRequestedAtMs]).toEqual(["running", null, 3]);
  const done = transitionRun(cancelled, token(cancelled), { type: "completed", atMs: 4, outcome: "succeeded", result });
  expect([done.status, done.effectState, done.stopConfirmedAtMs]).toEqual(["cancelled", "known", null]);
});
test("completion first cannot be rewritten by cancellation; identical facts repair acknowledgement loss", () => {
  const state = running();
  const fact = { type: "completed", atMs: 3, outcome: "succeeded", result };
  const done = transitionRun(state, token(state), fact);
  expect(transitionRun(done, token(state), { ...fact, atMs: 50 })).toEqual(done);
  expect(transitionRun(done, token(state), { type: "cancel", atMs: 4 })).toEqual(done);
  expect(() => transitionRun(done, token(done), { ...fact, outcome: "failed" })).toThrow("transition_conflict");
});
test("loss preserves cancellation precedence and never grants safe replay", () => {
  for (const reason of ["crash", "lost_protocol", "lease_expired"]) {
    const state = running();
    const lost = transitionRun(state, token(state), { type: "lost", atMs: 4, reason });
    expect([lost.status, lost.effectState, lost.stopConfirmedAtMs]).toEqual(["interrupted", "uncertain", null]);
    const cancelled = transitionRun(state, token(state), { type: "cancel", atMs: 3 });
    expect(transitionRun(cancelled, token(cancelled), { type: "lost", atMs: 4, reason }).status).toBe("cancelled");
    expect(() => transitionRun(lost, token(lost), { type: "claimed", atMs: 5, leaseId: lease, leaseExpiresAtMs: 100 })).toThrow("transition_conflict");
  }
});
test("current identity, revision, time and counter guards deny stale facts", () => {
  const state = running();
  for (const change of [{ runId: lease }, { attemptId: lease }, { generation: 2 }, { leaseId: id }])
    expect(() => transitionRun(state, { ...token(state), ...change }, { type: "cancel", atMs: 3 })).toThrow("stale_attempt");
  expect(() => transitionRun(state, { ...token(state), expectedRevision: 1 }, { type: "cancel", atMs: 3 })).toThrow("stale_revision");
  expect(() => transitionRun(state, token(state), { type: "cancel", atMs: 0 })).toThrow("invalid_input");
  const exhausted = { ...state, revision: 2147483647 };
  expect(() => transitionRun(exhausted, token(exhausted), { type: "cancel", atMs: 3 })).toThrow("transition_conflict");
  expect(() => transitionRun(state, token(state), { type: "completed", atMs: 3, outcome: "succeeded", result, noEffects: true })).toThrow("invalid_input");
});
test("confirmed stop is independent and cannot clear effect uncertainty", () => {
  const state = running();
  const lost = transitionRun(state, token(state), { type: "lost", atMs: 3, reason: "crash" });
  const stopped = transitionRun(lost, token(lost), { type: "stopped", atMs: 4 });
  expect([stopped.status, stopped.finishedAtMs, stopped.effectState, stopped.stopConfirmedAtMs]).toEqual(["interrupted", 3, "uncertain", 4]);
  expect(() => parseRunState({ ...state, ownerUserId: "owner" })).toThrow("storage_unavailable");
});
test("stop before terminal closes admission but does not settle the logical outcome", () => {
  const state = running();
  const stopped = transitionRun(state, token(state), { type: "stopped", atMs: 3 });
  expect([stopped.status, stopped.finishedAtMs, stopped.stopConfirmedAtMs]).toEqual(["running", null, 3]);
  expect(() => transitionRun(stopped, token(stopped), { type: "admitted", atMs: 4 })).toThrow("transition_conflict");
  expect(transitionRun(stopped, token(stopped), { type: "lost", atMs: 4, reason: "crash" }).effectState).toBe("uncertain");
});
test("closed state facts reject impossible lease, chronology and effect combinations", () => {
  for (const change of [{ leaseId: lease }, { effectState: "known" }, { finishedAtMs: 2 }, { result }, { cancellationReason: "owner_requested" }])
    expect(() => parseRunState({ ...queued(), ...change })).toThrow("storage_unavailable");
  for (const change of [{ claimedAtMs: null }, { stopConfirmedAtMs: 1 }, { leaseExpiresAtMs: 1 }, { startedAtMs: 3 }, { effectState: "known" }])
    expect(() => parseRunState({ ...running(), ...change })).toThrow("storage_unavailable");
});
test("uncertain harness terminal and conflicting replay preserve source/result bounds", () => {
  const state = running();
  const fact = { type: "completed", atMs: 3, outcome: "uncertain", result: { ...result, errorCode: "outcome_uncertain" } };
  const done = transitionRun(state, token(state), fact);
  expect([done.status, done.effectState]).toEqual(["interrupted", "uncertain"]);
  expect(() => transitionRun(done, token(done), { ...fact, result: { ...fact.result, text: "changed" } })).toThrow("transition_conflict");
  expect(() => transitionRun(state, token(state), { ...fact, result: { ...fact.result, lastSequence: 11 } })).toThrow("storage_unavailable");
  expect(() => transitionRun(done, { ...token(done), generation: 2 }, fact)).toThrow("stale_attempt");
});
test("each validated terminal outcome is closed against reactivation", () => {
  const outcomes: readonly TerminalOutcome[] = ["succeeded", "failed", "cancelled", "uncertain"];
  for (const outcome of outcomes) {
    const state = running();
    const done = transitionRun(state, token(state), { type: "completed", atMs: 3, outcome, result });
    expect(done.status).toBe(outcome === "uncertain" ? "interrupted" : outcome);
    expect(done.finishedAtMs).toBe(3);
    expect(Object.isFrozen(done.result)).toBe(true);
    for (const fact of [{ type: "admitted", atMs: 4 }, { type: "claimed", atMs: 4, leaseId: lease, leaseExpiresAtMs: 100 }])
      expect(() => transitionRun(done, token(done), fact)).toThrow("transition_conflict");
  }
});
for (const status of ["succeeded", "failed", "interrupted"]) {
  test(`persisted ${status} state rejects earlier owner cancellation`, () => {
    const value = { ...running(), status, effectState: status === "interrupted" ? "uncertain" : "known",
      startedAtMs: 3, finishedAtMs: 5, cancelRequestedAtMs: 4, cancellationReason: "owner_requested", result };
    expect(() => parseRunState(value)).toThrow("storage_unavailable");
    expect(parseRunState({ ...value, cancelRequestedAtMs: null, cancellationReason: null }).cancelRequestedAtMs).toBeNull();
    expect(parseRunState({ ...value, status: "cancelled" }).cancelRequestedAtMs).toBe(4);
    expect(parseRunState({ ...value, status: "running", effectState: "uncertain", finishedAtMs: null, result: null }).cancelRequestedAtMs).toBe(4);
  });
}
for (const status of ["succeeded", "failed"]) {
  test(`persisted ${status} state requires a complete result`, () => {
    const value = { ...running(), status, effectState: "known", startedAtMs: 3, finishedAtMs: 5, result: null };
    expect(() => parseRunState(value)).toThrow("storage_unavailable");
    expect(parseRunState({ ...value, result }).result?.text).toBe("done");
    for (const permitted of ["cancelled", "interrupted"])
      expect(parseRunState({ ...value, status: permitted, effectState: "uncertain" }).result).toBeNull();
  });
}
test("normalized cancellation replay keeps original finish across differing raw outcomes", () => {
  const state = running();
  const cancelled = transitionRun(state, token(state), { type: "cancel", atMs: 3 });
  const done = transitionRun(cancelled, token(cancelled), { type: "completed", atMs: 4, outcome: "succeeded", result });
  expect(transitionRun(done, token(cancelled), { type: "completed", atMs: 5, outcome: "failed", result })).toEqual(done);
});
test("trusted cancellation before admission terminalizes without inventing owner intent or stop", () => {
  for (const ownerIntent of [false, true]) {
    const initial = running(), state = ownerIntent ? transitionRun(initial, token(initial), { type: "cancel", atMs: 3 }) : initial;
    const done = transitionRun(state, token(state), { type: "cancelled_before_admission", atMs: 4 });
    expect([done.status, done.effectState, done.finishedAtMs, done.result, done.startedAtMs, done.stopConfirmedAtMs])
      .toEqual(["cancelled", "no_effect", 4, null, null, null]);
    expect([done.cancelRequestedAtMs, done.cancellationReason]).toEqual(ownerIntent ? [3, "owner_requested"] : [null, null]);
    expect([done.leaseId, done.claimedAtMs, done.leaseExpiresAtMs, done.revision]).toEqual([lease, 2, 100, state.revision + 1]);
    expect(Object.isFrozen(done)).toBe(true);
    expect(state.status).toBe("running");
    for (const atMs of [0, 4, 200]) expect(transitionRun(done, token(state), { type: "cancelled_before_admission", atMs })).toEqual(done);
    expect(() => transitionRun(done, { ...token(done), leaseId: id }, { type: "cancelled_before_admission", atMs: 5 })).toThrow("stale_attempt");
  }
});
test("no-admission cancellation denies queued, admitted, uncertain, stopped and conflicting terminal states", () => {
  const state = running(), fact = { type: "cancelled_before_admission", atMs: 5 };
  const admitted = transitionRun(state, token(state), { type: "admitted", atMs: 3 });
  const stopped = transitionRun(state, token(state), { type: "stopped", atMs: 3 });
  const cancelledQueued = transitionRun(queued(), token(queued()), { type: "cancel", atMs: 3 });
  const lost = transitionRun(state, token(state), { type: "lost", atMs: 3, reason: "crash" });
  const uncertain = parseRunState({ ...state, effectState: "uncertain" });
  for (const invalid of [queued(), admitted, stopped, cancelledQueued, lost, uncertain])
    expect(() => transitionRun(invalid, token(invalid), fact)).toThrow("transition_conflict");
  for (const outcome of ["succeeded", "failed", "cancelled", "uncertain"]) {
    const terminal = transitionRun(state, token(state), { type: "completed", atMs: 3, outcome, result });
    expect(() => transitionRun(terminal, token(terminal), fact)).toThrow("transition_conflict");
  }
  for (const patch of [{ result }, { leaseId: null }, { effectState: "known" }, { startedAtMs: 3 }])
    expect(() => transitionRun({ ...state, ...patch }, token(state), fact)).toThrow("storage_unavailable");
});
test("no-admission fact keeps closed syntax, identity, CAS, chronology and overflow guards", () => {
  const state = running(), fact = { type: "cancelled_before_admission", atMs: 3 };
  for (const patch of [{ runId: lease }, { attemptId: lease }, { generation: 2 }, { leaseId: id }])
    expect(() => transitionRun(state, { ...token(state), ...patch }, fact)).toThrow("stale_attempt");
  expect(() => transitionRun(state, { ...token(state), expectedRevision: 1 }, fact)).toThrow("stale_revision");
  for (const bad of [{ ...fact, atMs: 1 }, { ...fact, atMs: NaN }, { ...fact, atMs: Infinity }, { ...fact, atMs: 1.5 },
    { ...fact, atMs: Number.MAX_SAFE_INTEGER }, { type: fact.type }, { ...fact, reason: "owner" }, { ...fact, stopped: true }, { ...fact, result }])
    expect(() => transitionRun(state, token(state), bad)).toThrow("invalid_input");
  const intent = transitionRun(state, token(state), { type: "cancel", atMs: 4 });
  expect(() => transitionRun(intent, token(intent), fact)).toThrow("invalid_input");
  const exhausted = parseRunState({ ...state, revision: 2147483647 });
  expect(() => transitionRun(exhausted, token(exhausted), fact)).toThrow("transition_conflict");
  const last = parseRunState({ ...state, revision: 2147483646 });
  const done = transitionRun(last, token(last), fact);
  expect(done.revision).toBe(2147483647);
  expect(transitionRun(done, token(last), fact)).toEqual(done);
  const firstTerminal = transitionRun(state, token(state), fact);
  const stoppedTerminal = transitionRun(firstTerminal, token(firstTerminal), { type: "stopped", atMs: 4 });
  expect(() => transitionRun(stoppedTerminal, token(stoppedTerminal), fact)).toThrow("transition_conflict");
  for (const patch of [{ expectedRevision: 0 }, { expectedRevision: 2147483648 }, { generation: 2147483648 }])
    expect(() => transitionRun(state, { ...token(state), ...patch }, fact)).toThrow("invalid_input");
  expect(() => transitionRun(done, token(last), { ...fact, ownerRequested: true })).toThrow("invalid_input");
  expect(transitionRun(state, token(state), { ...fact, atMs: 2 }).finishedAtMs).toBe(2);
  expect(transitionRun(state, token(state), { ...fact, atMs: 100 }).finishedAtMs).toBe(100);
  expect(transitionRun(state, token(state), { ...fact, atMs: 101 }).finishedAtMs).toBe(101);
});

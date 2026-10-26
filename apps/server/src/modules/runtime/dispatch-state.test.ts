import { expect, test } from "bun:test";
import { canonicalDispatchAction } from "./dispatch-contract";
import { createDispatchGrant, parseDispatchGrant, projectDispatchCapacity, transitionDispatchGrant } from "./dispatch-state";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const action = () => ({ version: 1, ownerUserId: "actor", runId: uuid(1), attemptId: uuid(2), generation: 1,
  leaseId: uuid(3), actionId: uuid(4), launcherInstallationId: "launcher", policyVersion: "fixture-v1", receiptId: uuid(5),
  kind: "activate", sequence: 1, connectionId: null, credentialVersion: null, expiresAtMs: 20_000, descriptor: ["activate", uuid(4), "a".repeat(64)] });
const grant = () => createDispatchGrant(action(), { id: uuid(6), nowMs: 1000, attemptDeadlineMs: 40_000 });
const token = (g: ReturnType<typeof grant>) => ({ id: g.id, canonicalAction: g.canonicalAction, expectedRevision: g.revision });
const policy = { version: 1, launcherInstallationId: "launcher", policyVersion: "fixture-v1", globalLimit: 2, actorLimit: 1 };
const claim = (n = 1, ownerUserId = "actor") => ({ attemptId: uuid(n * 10), runId: uuid(n * 10 + 1), ownerUserId, generation: 1,
  leaseId: uuid(n * 10 + 2), claimOperationId: uuid(n * 10 + 3), launcherInstallationId: "launcher", policyVersion: "fixture-v1", revision: 1,
  createdAtMs: 1000, deadlineAtMs: 40_000, leaseExpiresAtMs: 2000, releasedAtMs: null, logicalStatus: "running",
  resourceState: "unknown", cleanup: "unconfirmed", pendingOperationId: uuid(n * 10 + 4) });

test("admits once and matching current-revision replay is inert", () => {
  // Given: a fresh pending grant.
  const pending = grant();
  // When: applying the same issue fact twice using each current revision.
  const first = transitionDispatchGrant(pending, token(pending), { type: "issue", atMs: 2000 });
  const replay = transitionDispatchGrant(first.grant, token(first.grant), { type: "issue", atMs: 2001 });
  // Then: only the first pure draft admits and no binding changes.
  expect(first.newAdmission).toBe(true);
  expect(replay.newAdmission).toBe(false);
  expect(replay.grant).toEqual(first.grant);
  expect(first.grant.canonicalAction).toBe(canonicalDispatchAction(action()));
  expect(Object.isFrozen(first.grant)).toBe(true);
});
test.each(["unknown", "cancel", "expire"] as const)("%s never returns an issued grant to pending", type => {
  // Given: an issued grant before delivery acknowledgement.
  const g = grant(), issued = transitionDispatchGrant(g, token(g), { type: "issue", atMs: 2000 }).grant;
  // When: applying the failure/cancellation/expiry fact and trying issue again.
  const changed = transitionDispatchGrant(issued, token(issued), { type, atMs: 20_000 }).grant;
  const replay = transitionDispatchGrant(changed, token(changed), { type: "issue", atMs: 20_001 });
  // Then: admission remains spent and delivery is never inferred from expiry.
  expect(replay.newAdmission).toBe(false);
  expect(replay.grant.state).not.toBe("pending");
  expect(replay.grant.deliveryOutcome).not.toBe("acknowledged");
});
test("unknown commit from pending blocks reissue, even after acknowledgement", () => {
  // Given: a pending snapshot whose commit response was lost.
  const g = grant();
  // When: retaining uncertainty and later a matching delivery fact.
  const unknown = transitionDispatchGrant(g, token(g), { type: "unknown", atMs: 2000 }).grant;
  const acknowledged = transitionDispatchGrant(unknown, token(unknown), { type: "ack", atMs: 3000 }).grant;
  const replay = transitionDispatchGrant(acknowledged, token(acknowledged), { type: "issue", atMs: 4000 });
  // Then: uncertainty remains sticky and no new draft admission exists.
  expect(acknowledged.state).toBe("uncertain");
  expect(acknowledged.issuedAtMs).toBeNull();
  expect(acknowledged.deliveryOutcome).toBe("acknowledged");
  expect(replay.newAdmission).toBe(false);
});
test.each(["cancel", "expire"] as const)("pending %s closes admission without delivery", type => {
  // Given: a pending grant.
  const g = grant();
  // When: cancelling or expiring before issue.
  const changed = transitionDispatchGrant(g, token(g), { type, atMs: 20_000 }).grant;
  // Then: no issue/acknowledgement can be manufactured.
  expect(changed.deliveryOutcome).toBe("not_attempted");
  expect(transitionDispatchGrant(changed, token(changed), { type: "issue", atMs: 20_001 }).newAdmission).toBe(false);
  expect(() => transitionDispatchGrant(changed, token(changed), { type: "ack", atMs: 20_001 })).toThrow();
});
test.each([{ id: uuid(99) }, { canonicalAction: canonicalDispatchAction({ ...action(), ownerUserId: "other" }) }, { expectedRevision: 2 }])("rejects changed CAS binding %j", change => {
  // Given: a legitimate state and substituted transition identity.
  const g = grant();
  // When/Then: substitution fails before admission.
  expect(() => transitionDispatchGrant(g, { ...token(g), ...change }, { type: "issue", atMs: 2000 })).toThrow();
});
test.each([999, 20_000])("rejects issue at invalid time %i", atMs => {
  // Given: a fresh grant.
  const g = grant();
  // When/Then: backwards or expired issue cannot admit.
  expect(() => transitionDispatchGrant(g, token(g), { type: "issue", atMs })).toThrow();
});
test.each([{ nowMs: 20_000 }, { attemptDeadlineMs: 19_999 }, { nowMs: -20_001 }, { attemptDeadlineMs: 61_001 }])("rejects invalid fresh admission %j", change => {
  // Given: a candidate exceeding expiry/deadline policy.
  const admission = { id: uuid(6), nowMs: 1000, attemptDeadlineMs: 40_000, ...change };
  // When/Then: construction fails.
  expect(() => createDispatchGrant(action(), admission)).toThrow();
});
test("rejects inconsistent stored state and revision exhaustion", () => {
  // Given: malformed persisted combinations and an exhausted issued revision.
  const g = grant(), issued = transitionDispatchGrant(g, token(g), { type: "issue", atMs: 2000 }).grant;
  const exhausted = parseDispatchGrant({ ...issued, revision: 2147483647 });
  // When/Then: impossible storage and changing an exhausted state both fail.
  for (const change of [{ deliveryOutcome: "acknowledged" }, { issuedAtMs: 2000 }, { state: "uncertain" }, { extra: true }]) expect(() => parseDispatchGrant({ ...g, ...change })).toThrow();
  expect(() => transitionDispatchGrant(exhausted, token(exhausted), { type: "ack", atMs: 3000 })).toThrow();
});
test.each(["unknown", "stopping", "prepare_pending", "active"])("counts terminal expired unreleased %s resources", resourceState => {
  // Given: logical termination and expired lease without resource release.
  const row = { ...claim(), logicalStatus: "cancelled", resourceState };
  // When: projecting occupancy.
  const result = projectDispatchCapacity(policy, [row], "actor");
  // Then: actor remains full despite terminal/expired metadata.
  expect(result).toEqual({ globalOccupied: 1, actorOccupied: 1, canClaim: false });
});
test("applies global and actor limits without a drifting counter", () => {
  // Given: two different owners at global capacity.
  const rows = [claim(1), claim(2, "other")];
  // When: projecting a third owner.
  const result = projectDispatchCapacity(policy, rows, "third");
  // Then: global capacity denies; one other actor alone permits.
  expect(result).toEqual({ globalOccupied: 2, actorOccupied: 0, canClaim: false });
  expect(projectDispatchCapacity(policy, [claim(1)], "other").canClaim).toBe(true);
});
test("excludes only released terminal resources with complete cleanup facts", () => {
  // Given: a terminal cleaned resource and durable release time.
  const released = { ...claim(), logicalStatus: "interrupted", resourceState: "cleaned", cleanup: "confirmed", pendingOperationId: null, releasedAtMs: 3000 };
  // When: projecting capacity.
  const result = projectDispatchCapacity(policy, [released], "actor");
  // Then: it frees occupancy while every inconsistent release is rejected.
  expect(result).toEqual({ globalOccupied: 0, actorOccupied: 0, canClaim: true });
  for (const change of [{ logicalStatus: "running" }, { cleanup: "unconfirmed" }, { pendingOperationId: uuid(8) }, { releasedAtMs: 999 }]) expect(() => projectDispatchCapacity(policy, [{ ...released, ...change }], "actor")).toThrow();
});
test("fails closed on missing policy, duplicate identity and malformed claims", () => {
  // Given: invalid policy and claim snapshots.
  const invalid = [[claim(), claim()], [{ ...claim(), revision: 2147483648 }], [{ ...claim(), policyVersion: "other" }], [{ ...claim(), extra: true }]];
  // When/Then: no projection grants capacity from invalid input.
  expect(() => projectDispatchCapacity(null, [], "actor")).toThrow();
  expect(() => projectDispatchCapacity({ ...policy, globalLimit: 3 }, [], "actor")).toThrow();
  for (const rows of invalid) expect(() => projectDispatchCapacity(policy, rows, "actor")).toThrow();
});
test("rejects stored cancellation that preceded issuance", () => {
  // Given: a claimed issued state with an earlier cancellation.
  const g = grant(), issued = transitionDispatchGrant(g, token(g), { type: "issue", atMs: 2000 }).grant;
  // When/Then: impossible chronology cannot pass storage parsing.
  expect(() => parseDispatchGrant({ ...issued, cancelledAtMs: 1500 })).toThrow();
});
test.each([
  { resourceState: "not_submitted" }, { resourceState: "prepare_pending", pendingOperationId: null },
])("rejects inconsistent resource operation facts %j", change => {
  // Given: resource state contradicting whether submission is pending.
  const row = { ...claim(), ...change };
  // When/Then: capacity projection refuses corrupted facts.
  expect(() => projectDispatchCapacity(policy, [row], "actor")).toThrow();
});
test("rejects stale original revision even for an otherwise matching replay", () => {
  // Given: the original issue token and its committed-state draft.
  const g = grant(), issued = transitionDispatchGrant(g, token(g), { type: "issue", atMs: 2000 }).grant;
  // When/Then: old CAS cannot masquerade as a current command.
  expect(() => transitionDispatchGrant(issued, token(g), { type: "issue", atMs: 2000 })).toThrow();
});
test("matching acknowledgements preserve revision and uncertainty never downgrades known delivery", () => {
  // Given: a known acknowledged grant.
  const g = grant(), issued = transitionDispatchGrant(g, token(g), { type: "issue", atMs: 2000 }).grant;
  const acknowledged = transitionDispatchGrant(issued, token(issued), { type: "ack", atMs: 3000 }).grant;
  // When: replaying that same delivery fact.
  const replay = transitionDispatchGrant(acknowledged, token(acknowledged), { type: "ack", atMs: 4000 });
  // Then: it is inert and a conflicting unknown fact is rejected.
  expect(replay.grant).toEqual(acknowledged);
  expect(replay.newAdmission).toBe(false);
  expect(() => transitionDispatchGrant(acknowledged, token(acknowledged), { type: "unknown", atMs: 4000 })).toThrow();
});
test("bounds the full claim snapshot without truncation", () => {
  // Given: one more claim than the bounded pure projection supports.
  const rows = Array.from({ length: 1025 }, (_, index) => claim(index + 1));
  // When/Then: the whole input is denied rather than undercounted.
  expect(() => projectDispatchCapacity(policy, rows, "actor")).toThrow();
});
test("denies oversized snapshots before visiting their records", () => {
  // Given: an oversized snapshot with observable record access.
  let visits = 0;
  const rows = Array.from({ length: 1025 }, (_, index) => claim(index + 1));
  Object.defineProperty(rows, 0, { get: () => { visits++; return claim(); } });
  // When: rejecting the oversized boundary.
  expect(() => projectDispatchCapacity(policy, rows, "actor")).toThrow();
  // Then: parsing work is bounded before record traversal.
  expect(visits).toBe(0);
});

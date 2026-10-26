import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { canonicalRunInput } from "./run-contract";
import { readRunRows } from "./run-rows";
import { readDispatchClaim } from "./dispatch-claim-rows";
const id = "00000000-0000-4000-8000-000000000001", aid = "00000000-0000-4000-8000-000000000002";
const lease = "00000000-0000-4000-8000-000000000003", op = "00000000-0000-4000-8000-000000000004";
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function fixture() {
  const input = { requestKey: id, origin: "interactive", botId: "bot", conversationId: "chat", configurationId: "config", configurationVersion: 1,
    input: { prompt: "private é", harness: "fixture", connections: [], model: null, resumeReference: null,
      budgets: { deadlineMs: 30000, maxEvents: 3, maxOutputBytes: 1000, maxToolBytes: 100, maxToolCalls: 0 } } };
  const run = { id, ownerUserId: "owner", requestKey: id, originKind: "interactive", botId: "bot", conversationId: "chat", configurationId: "config",
    configurationVersion: 1, inputVersion: 1, inputSnapshot: canonicalRunInput(input), createdAt: new Date(500), revision: 2, status: "running",
    currentGeneration: 1, cancelRequestedAt: null, startedAt: null, finishedAt: null,
    producerKind: null, producerVersion: null, actorActivationRevision: null };
  const attempt = { id: aid, runId: id, ownerUserId: "owner", generation: 1, createdAt: new Date(500), status: "running", effectState: "no_effect",
    leaseId: lease, leaseExpiresAt: new Date(31000), claimedAt: new Date(1000), startedAt: null, finishedAt: null, stopConfirmedAt: null,
    resultVersion: null, resultText: null, resultErrorCode: null, resultLastSequence: null, cancellationReason: null };
  const policy = { installationId: "installation", policyVersion: "policy", image: `sha256:${"a".repeat(64)}` };
  const canonical = JSON.stringify(["zetta.launch.spec", 1, ["owner", id, aid, "bot", "chat", "config", null, null], lease, 1, "fixture-v1", "echo", "policy", 31000, [30000, 65536, 1000, 1000]]);
  const claim = { attemptId: aid, runId: id, ownerUserId: "owner", generation: 1, leaseId: lease, claimOperationId: op,
    launcherInstallationId: policy.installationId, policyVersion: policy.policyVersion, launchSpecVersion: 1, launchSpecCanonical: canonical,
    launchSpecDigest: hash(canonical), launchIdentityDigest: hash(JSON.stringify(["zetta.launch.recipe", 1, "linux-systemd-v1", policy.installationId, policy.policyVersion, policy.image, hash(canonical)])),
    imageDigest: policy.image, deadlineAt: new Date(31000), receiptId: null, prepareIntentAt: null, resourceState: "not_submitted",
    pendingOperationId: null, pendingOperationKind: null, cleanupKind: null, cleanupConfirmedAt: null, cancelReason: null, cancelRequestedAt: null,
    releasedAt: null, revision: 1, createdAt: new Date(1000), updatedAt: new Date(1000) };
  return { input, run, attempt, policy, claim, current: readRunRows(run, attempt) };
}
test("historical claim parses without clock admission, is frozen and retains exact identity on repeated reads", () => {
  const f = fixture(), result = readDispatchClaim(f.claim, f.current, f.policy);
  expect(result.claim.createdAt).toBe(1000);
  expect(result.spec.deadlineEpochMs).toBe(31000);
  expect(readDispatchClaim(f.claim, f.current, f.policy)).toEqual(result);
  for (const value of [result, result.claim, result.spec, result.spec.context, result.spec.budgets]) expect(Object.isFrozen(value)).toBe(true);
  f.claim.createdAt.setTime(9000);
  expect(result.claim.createdAt).toBe(1000);
});
test("legacy and stamped run history remain readable without parsed metadata issuing claim authority", () => {
  const f = fixture(), legacy = readDispatchClaim(f.claim, f.current, f.policy);
  const current = readRunRows({ ...f.run, producerKind: "fixture", producerVersion: 1, actorActivationRevision: 7 }, f.attempt);
  const stamped = readDispatchClaim(f.claim, current, f.policy);
  expect(stamped).toEqual(legacy);
  expect(Object.keys(stamped).sort()).toEqual(["claim", "spec"]);
  expect(JSON.stringify(stamped)).not.toMatch(/producerKind|producerVersion|actorActivationRevision|eligible|authority/);
  expect(current.dto).toEqual(f.current.dto);
});
test("closed claim schema rejects malformed fields, identities, counters, times and canonical hashes", () => {
  const f = fixture();
  const patches: readonly Record<string, unknown>[] = [{ extra: true }, { attemptId: id }, { runId: aid }, { ownerUserId: "other" }, { generation: 2 },
    { leaseId: op }, { claimOperationId: "not-uuid" }, { launcherInstallationId: "other" }, { policyVersion: "other" }, { imageDigest: `sha256:${"b".repeat(64)}` },
    { launchSpecVersion: 2 }, { launchSpecCanonical: f.claim.launchSpecCanonical + " " }, { launchSpecDigest: "b".repeat(64) }, { launchIdentityDigest: "c".repeat(64) },
    { revision: 0 }, { revision: 2147483648 }, { generation: 1.5 }, { createdAt: new Date(999) }, { updatedAt: new Date(999) }, { deadlineAt: new Date(1000) },
    { deadlineAt: new Date(61001) }, { deadlineAt: new Date(NaN) }, { updatedAt: 1000 }, { resourceState: "future" }, { cancelReason: "future" },
    { pendingOperationKind: "future" }, { cleanupKind: "future" }, { ownerUserId: "owñer" }, { launchSpecDigest: "A".repeat(64) }];
  for (const patch of patches) expect(() => readDispatchClaim({ ...f.claim, ...patch }, f.current, f.policy)).toThrow("invalid_claim");
  for (const raw of [null, [], "claim", {}, { ...f.claim, producerKind: "fixture" }]) expect(() => readDispatchClaim(raw, f.current, f.policy)).toThrow("invalid_claim");
});
test("nullable pairs and resource facts need coherent positive controls", () => {
  const f = fixture(), base = { ...f.claim, revision: 2, updatedAt: new Date(4000) };
  const pending = { ...base, resourceState: "prepare_pending", prepareIntentAt: new Date(2000), pendingOperationId: op, pendingOperationKind: "prepare" };
  const prepared = { ...base, resourceState: "prepared", prepareIntentAt: new Date(2000), receiptId: op };
  for (const claim of [base, pending, prepared, { ...prepared, resourceState: "active" }, { ...prepared, resourceState: "stopping" },
    { ...pending, resourceState: "unknown" }, { ...prepared, resourceState: "unknown" },
    { ...prepared, resourceState: "cleaned", cleanupKind: "removed", cleanupConfirmedAt: new Date(3000) },
    { ...base, cancelReason: "shutdown", cancelRequestedAt: new Date(3000) }]) expect(readDispatchClaim(claim, f.current, f.policy).claim.revision).toBe(2);
  for (const patch of [{ pendingOperationId: op }, { pendingOperationKind: "prepare" }, { cleanupKind: "not_submitted" }, { cleanupConfirmedAt: new Date(2000) },
    { cancelReason: "owner" }, { cancelRequestedAt: new Date(2000) }, { releasedAt: new Date(3000) }, { prepareIntentAt: new Date(2000) }, { receiptId: op },
    { cancelReason: "deadline", cancelRequestedAt: new Date(3000) }, { cleanupKind: "removed", cleanupConfirmedAt: new Date(3000) }]) {
    expect(() => readDispatchClaim({ ...base, ...patch }, f.current, f.policy)).toThrow("invalid_claim");
  }
  for (const patch of [{ receiptId: null }, { prepareIntentAt: null }, { cleanupKind: "removed", cleanupConfirmedAt: new Date(3000) },
    { pendingOperationKind: "input", pendingOperationId: null }, { prepareIntentAt: new Date(4001) }, { prepareIntentAt: new Date(999) }]) {
    expect(() => readDispatchClaim({ ...prepared, ...patch }, f.current, f.policy)).toThrow("invalid_claim");
  }
  expect(() => readDispatchClaim({ ...pending, pendingOperationKind: "input" }, f.current, f.policy)).toThrow("invalid_claim");
  expect(() => readDispatchClaim({ ...prepared, revision: 1 }, f.current, f.policy)).toThrow("invalid_claim");
});
test("release needs a coherent terminal current attempt, retains owner cancellation and never implies authority", () => {
  const f = fixture(), run = { ...f.run, status: "cancelled", cancelRequestedAt: new Date(2000), finishedAt: new Date(3000) };
  const attempt = { ...f.attempt, status: "cancelled", cancellationReason: "owner_requested", finishedAt: new Date(3000) };
  const current = readRunRows(run, attempt);
  const claim = { ...f.claim, revision: 2, updatedAt: new Date(4000), cancelReason: "owner", cancelRequestedAt: new Date(2000),
    cleanupKind: "not_submitted", cleanupConfirmedAt: new Date(3000), releasedAt: new Date(4000) };
  const parsed = readDispatchClaim(claim, current, f.policy);
  expect(Object.keys(parsed).sort()).toEqual(["claim", "spec"]);
  expect(parsed.claim.cancelRequestedAt).toBe(2000);
  expect(() => readDispatchClaim(claim, f.current, f.policy)).toThrow("invalid_claim");
  for (const patch of [{ cancelRequestedAt: new Date(2001) }, { releasedAt: new Date(2999) }, { cleanupConfirmedAt: new Date(4001) }]) {
    expect(() => readDispatchClaim({ ...claim, ...patch }, current, f.policy)).toThrow("invalid_claim");
  }
});
test("even recomputed digests cannot substitute the pinned current context or budget", () => {
  const f = fixture();
  const substitutions: readonly (readonly [string, string])[] = [["owner", "other"], ["bot", "other"], ["chat", "other"], ["config", "other"], ["echo", "wait"],
    ["30000,65536", "29999,65536"], ["65536,1000", "65535,1000"], ["1000,1000", "999,999"], ["null,null", '"routine",null']];
  for (const [from, to] of substitutions) {
    const canonical = f.claim.launchSpecCanonical.replace(from, to), digest = hash(canonical);
    const claim = { ...f.claim, launchSpecCanonical: canonical, launchSpecDigest: digest,
      launchIdentityDigest: hash(JSON.stringify(["zetta.launch.recipe", 1, "linux-systemd-v1", f.policy.installationId, f.policy.policyVersion, f.policy.image, digest])) };
    expect(() => readDispatchClaim(claim, f.current, f.policy)).toThrow("invalid_claim");
  }
  const current = readRunRows(f.run, { ...f.attempt, leaseExpiresAt: new Date(31001) });
  expect(() => readDispatchClaim(f.claim, current, f.policy)).toThrow("invalid_claim");
  expect(() => readDispatchClaim(f.claim, f.current, { ...f.policy, image: `sha256:${"b".repeat(64)}` })).toThrow("invalid_claim");
});

test("current parsed input constraints are rechecked without fabricating producer eligibility", () => {
  const f = fixture();
  for (const patch of [{ maxToolCalls: 1 }, { maxOutputBytes: 65537 }, { deadlineMs: 30001 }]) {
    const input = { ...f.input, input: { ...f.input.input, budgets: { ...f.input.input.budgets, ...patch } } };
    const current = readRunRows({ ...f.run, inputSnapshot: canonicalRunInput(input) }, f.attempt);
    expect(() => readDispatchClaim(f.claim, current, f.policy)).toThrow("invalid_claim");
  }
  for (const patch of [{ claimedAt: new Date(1001) }, { leaseId: op }]) {
    const current = readRunRows(f.run, { ...f.attempt, ...patch });
    expect(() => readDispatchClaim(f.claim, current, f.policy)).toThrow("invalid_claim");
  }
  const next = readRunRows({ ...f.run, currentGeneration: 2 }, { ...f.attempt, generation: 2 });
  expect(() => readDispatchClaim(f.claim, next, f.policy)).toThrow("invalid_claim");
  expect(readDispatchClaim({ ...f.claim, revision: 2147483647 }, f.current, f.policy).claim.revision).toBe(2147483647);
  const intent = { ...f.claim, revision: 2, cancelReason: "deadline", cancelRequestedAt: new Date(31000), updatedAt: new Date(31000) };
  expect(readDispatchClaim(intent, f.current, f.policy).claim.cancelRequestedAt).toBe(31000);
});

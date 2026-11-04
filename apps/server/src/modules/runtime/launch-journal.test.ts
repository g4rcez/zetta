import { expect, test } from "bun:test";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";
import { parseLaunchSpec, parseStoredLaunchSpec } from "./launch-spec";
import { createLaunchJournal, parseJournalOperation, parseLaunchJournal } from "./launch-journal";

const policy = createFixtureLaunchPolicy({
  installationId: "install-a",
  policyVersion: "fixture-policy-2",
  image: `sha256:${"1".repeat(64)}`,
});
const admission = {
  nowEpochMs: 1000,
  authorizedDeadlineEpochMs: 31_000,
  policyVersion: policy.policyVersion,
};
const raw = () => ({
  version: 1,
  context: {
    actorId: "actor-a",
    runId: "run-a",
    attemptId: "attempt-a",
    botId: "bot-a",
    conversationId: "chat-a",
    configurationId: "config-a",
  },
  leaseId: "lease-a",
  fence: 1,
  recipe: "fixture-v1",
  fixtureCase: "echo",
  policyVersion: policy.policyVersion,
  deadlineEpochMs: 31_000,
  budgets: {
    deadlineMs: 30_000,
    maxInputBytes: 65_536,
    maxOutputBytes: 65_536,
    maxFrameBytes: 8192,
  },
});
const record = () =>
  createLaunchJournal(expandFixtureRecipe(parseLaunchSpec(raw(), admission), policy), admission);

test("loads expired historical shape without granting fresh admission", () => {
  // Given
  const historical = raw();
  // When
  const stored = parseStoredLaunchSpec(historical);
  // Then
  expect(stored.deadlineEpochMs).toBe(31_000);
  expect(() => parseLaunchSpec(stored, { ...admission, nowEpochMs: 31_000 })).toThrow(
    "deadline_denied",
  );
  expect(() =>
    createLaunchJournal(expandFixtureRecipe(stored, policy), { ...admission, nowEpochMs: 31_000 }),
  ).toThrow("deadline_denied");
});

test("generates distinct owned receipts and loads a private immutable roundtrip", () => {
  // Given
  const first = record(),
    second = record();
  // When
  const loaded = parseLaunchJournal(JSON.parse(JSON.stringify(first)), {
    policy,
    receiptId: first.receiptId,
  });
  // Then
  expect(loaded).toEqual(first);
  expect(first.receiptId).not.toBe(second.receiptId);
  expect(first.containerName).not.toBe(second.containerName);
  expect(first.ownershipLabel).not.toBe(second.ownershipLabel);
  expect(first.ownershipDigest).not.toBe(second.ownershipDigest);
  expect(first.pendingOperation).toBeNull();
  expect(first.phase).toBe("intent");
  const objects: object[] = [loaded];
  for (const object of objects)
    for (const value of Object.values(object))
      if (typeof value === "object" && value !== null) objects.push(value);
  expect(objects.every(Object.isFrozen)).toBe(true);
});

for (const change of [
  { version: 2 },
  { secret: "synthetic-not-a-secret" },
  { specDigest: "0".repeat(64) },
  { identityDigest: "0".repeat(64) },
  { ownershipDigest: "0".repeat(64) },
  { containerName: "foreign" },
  { ownershipLabel: "0".repeat(64) },
  { runnerUnitId: "foreign.service" },
  { containerId: "abc" },
  { phase: "running" },
  { cleanup: "confirmed" },
  { terminal: "succeeded" },
  { pendingOperation: { id: "bad", type: "create" } },
  { inputBytes: 1 },
])
  test("rejects corrupt or authority-extending records", () => {
    // Given
    const original = record();
    // When / Then
    expect(() => parseLaunchJournal({ ...original, ...change }, { policy })).toThrow(
      "invalid_journal",
    );
  });

test("rejects changed immutable context and foreign trusted lookup policy", () => {
  // Given
  const original = record();
  // When / Then
  expect(() =>
    parseLaunchJournal({ ...original, spec: { ...original.spec, fence: 2 } }, { policy }),
  ).toThrow("invalid_journal");
  expect(() => parseLaunchJournal(original, { policy, receiptId: record().receiptId })).toThrow(
    "identity_mismatch",
  );
  expect(() =>
    parseLaunchJournal(original, {
      policy: createFixtureLaunchPolicy({ ...policy, installationId: "install-b" }),
    }),
  ).toThrow("identity_mismatch");
});

test("rejects a container ID without any acknowledged ownership operation", () => {
  // Given
  const original = record();
  // When
  const forged = {
    ...original,
    phase: "quarantined",
    cancelIntent: "recovery",
    outcomeUncertain: true,
    cleanup: "unknown",
    containerId: "a".repeat(64),
  };
  // Then
  expect(() => parseLaunchJournal(forged, { policy })).toThrow("invalid_journal");
});

for (const change of [
  { installationId: "install-b" },
  { policyVersion: "other" },
  { image: `sha256:${"2".repeat(64)}` },
])
  test("refuses a stored policy outside the trusted operator policy", () => {
    // Given
    const original = record();
    // When
    const forged = { ...original, policy: { ...policy, ...change } };
    // Then
    expect(() => parseLaunchJournal(forged, { policy })).toThrow("identity_mismatch");
  });

for (const change of [
  { settled: true },
  { image: "caller-image" },
  { sequence: 0 },
  { type: "restart" },
  { input: { id: "input", sequence: 1, byteLength: 1, eof: false } },
])
  test("rejects operation authority extensions and mismatched input metadata", () => {
    // Given
    const operation = {
      id: "11111111-1111-4111-8111-111111111111",
      sequence: 1,
      type: "create",
      input: null,
    };
    // When
    const invoke = () => parseJournalOperation({ ...operation, ...change });
    // Then
    expect(invoke).toThrow("invalid_operation");
  });

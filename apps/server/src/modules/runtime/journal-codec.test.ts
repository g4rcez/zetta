import { expect, test } from "bun:test";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";
import { parseLaunchSpec } from "./launch-spec";
import type { LaunchJournal } from "./launch-journal";
import { createLaunchJournal, journalDigest } from "./launch-journal";
import { decodeJournal, encodeJournal, JOURNAL_BYTE_LIMIT } from "./journal-codec";

function codecFixture(maximum = false) {
  const id = maximum ? "a".repeat(128) : "fixture";
  const policy = createFixtureLaunchPolicy({ installationId: id, policyVersion: id, image: `sha256:${"1".repeat(64)}` });
  const admission = { nowEpochMs: 1000, authorizedDeadlineEpochMs: 61000, policyVersion: id };
  const spec = parseLaunchSpec({ version: 1, context: { actorId: id, runId: id, attemptId: id, botId: id, conversationId: id, configurationId: id, routineId: id, delegationId: id },
    leaseId: id, fence: Number.MAX_SAFE_INTEGER, recipe: "fixture-v1", fixtureCase: "term-resistant", policyVersion: id, deadlineEpochMs: 61000,
    budgets: { deadlineMs: 60000, maxInputBytes: 65536, maxOutputBytes: 65536, maxFrameBytes: 8192 } }, admission);
  const record = createLaunchJournal(expandFixtureRecipe(spec, policy), admission);
  return { record, trusted: { policy, receiptId: record.receiptId } };
}

test("canonical disk bytes roundtrip historically, with one newline and immutable parsed fields", () => {
  const { record, trusted } = codecFixture();
  const bytes = encodeJournal(record, trusted);
  expect(bytes.toString()).toBe(JSON.stringify(record) + "\n");
  const loaded = decodeJournal(bytes, trusted);
  expect(loaded).toEqual(record);
  expect(Object.isFrozen(loaded.spec.context)).toBe(true);
  expect(() => parseLaunchSpec(loaded.spec, { nowEpochMs: 61000, authorizedDeadlineEpochMs: 61000, policyVersion: trusted.policy.policyVersion })).toThrow("deadline_denied");
});

test("rejects noncanonical encodings, malformed bytes, foreign authority and unbounded records", () => {
  const { record, trusted } = codecFixture();
  const text = encodeJournal(record, trusted).toString();
  for (const bytes of [Buffer.from(text.trim()), Buffer.from(" " + text), Buffer.from("\ufeff" + text), Buffer.from(text + "\n"),
    Buffer.from(text.replace('"version":1', '"version":1,"version":1')), Buffer.from(text.replace('"version":1', '"version":1.0')),
    Buffer.from(text.replace('"version":1', '"version":1,"private":"synthetic"')), Buffer.from([0xff]), Buffer.alloc(JOURNAL_BYTE_LIMIT + 1)]) {
    expect(() => decodeJournal(bytes, trusted)).toThrow("invalid_journal_bytes");
  }
  expect(() => decodeJournal(Buffer.from(text), { ...trusted, receiptId: "foreign" })).toThrow("invalid_journal_bytes");
  expect(() => encodeJournal({ ...record, version: 2 }, trusted)).toThrow("invalid_journal_bytes");
});

test("maximum-width strings and a fully populated legal journal fit the fixed disk budget", () => {
  const { record, trusted } = codecFixture(true);
  const input = { id: "a".repeat(128), sequence: 50000, byteLength: 8192, eof: true };
  const containerId = "f".repeat(64);
  const full = { ...record, containerId, phase: "quarantined", cancelIntent: "revocation", outcomeUncertain: true, cleanup: "unknown",
    observedAtEpochMs: Number.MAX_SAFE_INTEGER, inputBytes: 65536, lastInput: input, operationSequence: 50002,
    pendingOperation: { id: "11111111-1111-4111-8111-111111111111", sequence: 50002, type: "input", input },
    lastOperation: { operation: { id: "22222222-2222-4222-8222-222222222222", sequence: 50001, type: "input", input: { ...input, sequence: 49999 } },
      factDigest: journalDigest(["input_written", containerId, record.containerName, record.ownershipLabel, record.identityDigest]) } } satisfies LaunchJournal;
  const bytes = encodeJournal(full, trusted);
  expect(bytes.length).toBeLessThanOrEqual(JOURNAL_BYTE_LIMIT);
  expect(decodeJournal(bytes, trusted)).toEqual(full);
});

import { expect, test } from "bun:test";
import { digestLaunchSpec, parseLaunchSpec } from "./launch-spec";

const admission = {
  nowEpochMs: 1_000,
  authorizedDeadlineEpochMs: 61_000,
  policyVersion: "fixture-policy-1",
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
  policyVersion: "fixture-policy-1",
  deadlineEpochMs: 31_000,
  budgets: {
    deadlineMs: 30_000,
    maxInputBytes: 65_536,
    maxOutputBytes: 65_536,
    maxFrameBytes: 8_192,
  },
});

test("copies and freezes the admitted launch when caller objects later change", () => {
  // Given
  const request = raw();
  // When
  const spec = parseLaunchSpec(request, admission);
  request.context.actorId = "actor-b";
  request.budgets.deadlineMs = 60_000;
  // Then
  expect(String(spec.context.actorId)).toBe("actor-a");
  expect(spec.budgets.deadlineMs).toBe(30_000);
  expect([spec, spec.context, spec.budgets].every(Object.isFrozen)).toBe(true);
});

for (const extra of [
  { image: "attacker/image:latest" },
  { env: { HOME: "/host" } },
  { mounts: ["/var/run/docker.sock"] },
  { executable: "/bin/sh" },
  { argv: ["-c", "unsafe"] },
  { workdir: "/host" },
  { network: "host" },
  { credentials: "private" },
  { resume: "foreign" },
  { model: "native-model" },
  { nowEpochMs: 0 },
]) {
  test(`rejects unrecognized launch authority ${Object.keys(extra)[0]}`, () => {
    // Given / When / Then
    expect(() => parseLaunchSpec({ ...raw(), ...extra }, admission)).toThrow("invalid_spec");
  });
}

for (const change of [
  { version: 2 },
  { recipe: "pi" },
  { fixtureCase: "echo; sh" },
  { leaseId: "../actor-b" },
  { fence: 0 },
  { fence: 1.5 },
  { fence: Number.MAX_SAFE_INTEGER + 1 },
  { context: { ...raw().context, env: {} } },
  { context: { ...raw().context, actorId: "a/b" } },
  { budgets: { ...raw().budgets, extra: true } },
  { budgets: { ...raw().budgets, deadlineMs: 60_001 } },
  { budgets: { ...raw().budgets, maxInputBytes: 0 } },
  { budgets: { ...raw().budgets, maxOutputBytes: 65_537 } },
  { budgets: { ...raw().budgets, maxFrameBytes: 8_193 } },
  { budgets: { ...raw().budgets, maxInputBytes: 1, maxFrameBytes: 2 } },
  { budgets: { ...raw().budgets, maxOutputBytes: 1, maxFrameBytes: 2 } },
  { deadlineEpochMs: Infinity },
  { deadlineEpochMs: Number.MAX_SAFE_INTEGER + 1 },
]) {
  test("rejects malformed or unsupported launch values at admission", () => {
    // Given / When / Then
    expect(() => parseLaunchSpec({ ...raw(), ...change }, admission)).toThrow("invalid_spec");
  });
}

for (const deadlineEpochMs of [1_000, 999, 61_001, 31_001]) {
  test(`rejects expired or over-budget absolute deadline ${deadlineEpochMs}`, () => {
    // Given / When / Then
    expect(() => parseLaunchSpec({ ...raw(), deadlineEpochMs }, admission)).toThrow(
      "deadline_denied",
    );
  });
}

for (const deadlineMs of [1, 60_000]) {
  test(`admits the exact ${deadlineMs} millisecond trusted deadline boundary`, () => {
    // Given
    const request = {
      ...raw(),
      deadlineEpochMs: admission.nowEpochMs + deadlineMs,
      budgets: { ...raw().budgets, deadlineMs },
    };
    // When
    const spec = parseLaunchSpec(request, admission);
    // Then
    expect(spec.deadlineEpochMs).toBe(request.deadlineEpochMs);
  });
}

test("rejects a deadline exceeding the server-authorized ceiling", () => {
  // Given / When / Then
  expect(() => parseLaunchSpec(raw(), { ...admission, authorizedDeadlineEpochMs: 30_999 })).toThrow(
    "deadline_denied",
  );
});

for (const change of [
  { nowEpochMs: NaN },
  { nowEpochMs: -1 },
  { nowEpochMs: 1.5 },
  { authorizedDeadlineEpochMs: Infinity },
]) {
  test("rejects invalid trusted clock or deadline inputs", () => {
    // Given / When / Then
    expect(() => parseLaunchSpec(raw(), { ...admission, ...change })).toThrow("invalid_admission");
  });
}

test("rejects a request bound to another installed policy", () => {
  // Given / When / Then
  expect(() => parseLaunchSpec(raw(), { ...admission, policyVersion: "fixture-policy-2" })).toThrow(
    "unsupported_policy",
  );
});

test("preserves digest and absolute expiry when the same descriptor is admitted later", () => {
  // Given
  const first = parseLaunchSpec(raw(), admission);
  // When
  const later = parseLaunchSpec(raw(), { ...admission, nowEpochMs: 2_000 });
  // Then
  expect(digestLaunchSpec(later)).toBe(digestLaunchSpec(first));
  expect(later.deadlineEpochMs).toBe(31_000);
});

test("canonicalizes object key order and absent optional identities", () => {
  // Given
  const value = raw();
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  // When
  const digests = [
    value,
    reordered,
    { ...value, context: { ...value.context, routineId: undefined, delegationId: undefined } },
  ].map((request) => digestLaunchSpec(parseLaunchSpec(request, admission)));
  // Then
  expect(new Set(digests).size).toBe(1);
});

test("binds every variable semantic field into descriptor identity", () => {
  // Given
  const value = raw();
  const contextChanges = [
    "actorId",
    "runId",
    "attemptId",
    "botId",
    "conversationId",
    "configurationId",
    "routineId",
    "delegationId",
  ].map((key) => ({ ...value, context: { ...value.context, [key]: "different" } }));
  const changes = [
    ...contextChanges,
    { ...value, leaseId: "lease-b" },
    { ...value, fence: 2 },
    { ...value, fixtureCase: "fork" },
    { ...value, policyVersion: "fixture-policy-2" },
    { ...value, deadlineEpochMs: 30_999 },
    ...Object.entries({
      deadlineMs: 30_001,
      maxInputBytes: 65_535,
      maxOutputBytes: 65_535,
      maxFrameBytes: 8_191,
    }).map(([key, changed]) => ({ ...value, budgets: { ...value.budgets, [key]: changed } })),
  ];
  const baseline = digestLaunchSpec(parseLaunchSpec(value, admission));
  // When
  const digests = changes.map((request) =>
    digestLaunchSpec(
      parseLaunchSpec(request, { ...admission, policyVersion: request.policyVersion }),
    ),
  );
  // Then
  expect(digests.every((digest) => digest !== baseline)).toBe(true);
  expect(new Set(digests).size).toBe(changes.length);
});

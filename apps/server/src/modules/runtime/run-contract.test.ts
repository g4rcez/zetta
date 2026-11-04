import { describe, expect, test } from "bun:test";
import {
  canonicalRunInput,
  decodeRunInput,
  parseCancelRunRequest,
  parseOwnedRunRequest,
  parseRunDto,
  parseRunResult,
  parseRunResultDto,
  parseSubmitRequest,
  toHarnessInput,
} from "./run-contract";

const key = "00000000-0000-4000-8000-000000000001";
function request() {
  return {
    requestKey: key,
    origin: "interactive",
    botId: "bot",
    conversationId: "chat",
    configurationId: "config",
    configurationVersion: 1,
    input: {
      prompt: "\uFEFF é e\u0301\n",
      harness: "fixture",
      model: null,
      resumeReference: null,
      connections: [],
      budgets: {
        deadlineMs: 1000,
        maxEvents: 20,
        maxOutputBytes: 1000,
        maxToolBytes: 100,
        maxToolCalls: 0,
      },
    },
  };
}
describe("durable run input", () => {
  test("canonical bytes have an independent fixed-position oracle and exact roundtrip", () => {
    const parsed = parseSubmitRequest(request());
    const expected = JSON.stringify([
      "zetta.run.input",
      1,
      key,
      "interactive",
      "bot",
      "chat",
      "config",
      1,
      "\uFEFF é e\u0301\n",
      "fixture",
      null,
      [1000, 20, 1000, 100, 0],
      [],
      null,
    ]);
    expect(canonicalRunInput(parsed)).toBe(expected);
    expect(decodeRunInput(expected)).toEqual(parsed);
    expect(() => decodeRunInput(` ${expected}`)).toThrow("invalid_input");
  });
  test("null normalization and nested copies freeze caller-independent input", () => {
    const source = request();
    const parsed = parseSubmitRequest({
      ...source,
      input: { ...source.input, model: undefined, resumeReference: undefined },
    });
    source.input.budgets.maxEvents = 5;
    source.input.prompt = "changed";
    expect(parsed.input.budgets.maxEvents).toBe(20);
    expect(parsed.input.prompt).toBe("\uFEFF é e\u0301\n");
    expect(parsed.input.model).toBeNull();
    for (const value of [parsed, parsed.input, parsed.input.budgets, parsed.input.connections])
      expect(Object.isFrozen(value)).toBe(true);
  });
  test("every supported semantic field changes canonical identity", () => {
    const original = request();
    const baseline = canonicalRunInput(original);
    for (const replacement of [
      { requestKey: "00000000-0000-4000-8000-000000000002" },
      { origin: "setup" },
      { botId: "b2" },
      { conversationId: "c2" },
      { configurationId: "v2" },
      { configurationVersion: 2 },
    ])
      expect(canonicalRunInput({ ...original, ...replacement })).not.toBe(baseline);
    for (const replacement of [{ prompt: "different" }, { model: "model" }])
      expect(
        canonicalRunInput({ ...original, input: { ...original.input, ...replacement } }),
      ).not.toBe(baseline);
    for (const replacement of [
      { deadlineMs: 999 },
      { maxEvents: 19 },
      { maxOutputBytes: 999 },
      { maxToolBytes: 99 },
      { maxToolCalls: 1 },
    ])
      expect(
        canonicalRunInput({
          ...original,
          input: { ...original.input, budgets: { ...original.input.budgets, ...replacement } },
        }),
      ).not.toBe(baseline);
  });
  test("native paths are unsupported, invalid fields never become authority", () => {
    for (const harness of ["pi", "codex", "omp", "claude-code", "opencode", "cursor"])
      expect(() =>
        parseSubmitRequest({ ...request(), input: { ...request().input, harness } }),
      ).toThrow("unsupported");
    for (const extra of [
      { connections: [{ reference: "ref", credentialVersion: 1 }] },
      { resumeReference: "session" },
    ])
      expect(() =>
        parseSubmitRequest({ ...request(), input: { ...request().input, ...extra } }),
      ).toThrow("unsupported");
    expect(() =>
      parseSubmitRequest({
        ...request(),
        input: {
          ...request().input,
          connections: [
            { reference: "ref", credentialVersion: 1 },
            { reference: "ref", credentialVersion: 2 },
          ],
        },
      }),
    ).toThrow("invalid_input");
    for (const field of ["actorId", "runId", "attemptId", "secret", "environment"])
      expect(() => parseSubmitRequest({ ...request(), [field]: "private" })).toThrow(
        "invalid_input",
      );
  });
  test("byte, Unicode, integer and escaped canonical bounds are enforced", () => {
    for (const prompt of ["\0", "\ud800", "é".repeat(32769), "\u0001".repeat(20000)])
      expect(() =>
        canonicalRunInput({ ...request(), input: { ...request().input, prompt } }),
      ).toThrow("invalid_input");
    expect(
      parseSubmitRequest({ ...request(), input: { ...request().input, prompt: "é".repeat(32768) } })
        .input.prompt.length,
    ).toBe(32768);
    for (const configurationVersion of [0, 1.5, 2147483648, NaN, Infinity])
      expect(() => parseSubmitRequest({ ...request(), configurationVersion })).toThrow(
        "invalid_input",
      );
  });
  test("canonical restoration rejects noncanonical encoding and malformed tuples", () => {
    const canonical = canonicalRunInput(request());
    for (const changed of [
      canonical.replace("é", "\\u00e9"),
      canonical.slice(0, -1),
      canonical.replace('"fixture"', '"codex"'),
      canonical.replace(",null]", ',"session"]'),
    ])
      expect(() => decodeRunInput(changed)).toThrow();
    for (const extra of [
      { secret: "sensitive-marker" },
      { env: { TOKEN: "sensitive-marker" } },
      { context: { actorId: "foreign" } },
    ]) {
      try {
        parseSubmitRequest({ ...request(), input: { ...request().input, ...extra } });
        throw new Error("accepted");
      } catch (error) {
        expect(String(error)).toBe("RunBoundaryError: invalid_input");
      }
    }
  });
  test("harness identity comes from a strict trusted tuple", () => {
    const input = toHarnessInput(request(), {
      actorId: "owner",
      runId: key,
      attemptId: "00000000-0000-4000-8000-000000000002",
    });
    expect(JSON.stringify(input.context)).toBe(
      JSON.stringify({
        actorId: "owner",
        runId: key,
        attemptId: "00000000-0000-4000-8000-000000000002",
        botId: "bot",
        conversationId: "chat",
        configurationId: "config",
      }),
    );
    expect(input.connections).toEqual([]);
    expect(() =>
      toHarnessInput(request(), { actorId: "owner", runId: key, attemptId: key, secret: "x" }),
    ).toThrow("invalid_input");
  });
});
test("result and DTO readers reject private extras, invalid time and result bounds", () => {
  const dto = {
    id: key,
    revision: 1,
    origin: "interactive",
    botId: "bot",
    conversationId: "chat",
    configurationId: "cfg",
    configurationVersion: 1,
    status: "queued",
    attemptId: key,
    generation: 1,
    effectState: "no_effect",
    createdAtMs: 1,
    startedAtMs: null,
    finishedAtMs: null,
    cancelRequestedAtMs: null,
  };
  expect(Object.isFrozen(parseRunDto(dto))).toBe(true);
  for (const extra of [{ secret: "hidden" }, { createdAtMs: 9007199254740991 }, { revision: 0 }])
    expect(() => parseRunDto({ ...dto, ...extra })).toThrow("storage_unavailable");
  const result = { version: 1, text: "private text", errorCode: null, lastSequence: 3 };
  expect(Object.isFrozen(parseRunResult(result, 3))).toBe(true);
  for (const extra of [
    { lastSequence: 4 },
    { text: "é".repeat(32769) },
    { text: "\0" },
    { stderr: "secret" },
  ])
    expect(() => parseRunResult({ ...result, ...extra }, 3)).toThrow("storage_unavailable");
  const envelope = {
    runId: key,
    attemptId: key,
    generation: 1,
    status: "succeeded",
    effectState: "known",
    finishedAtMs: 3,
    result,
  };
  expect(parseRunResultDto(envelope, 3).result).toEqual(parseRunResult(result, 3));
  expect(() => parseRunResultDto({ ...envelope, ownerUserId: "private" }, 3)).toThrow(
    "storage_unavailable",
  );
  expect(parseOwnedRunRequest({ runId: key }).runId).toBe(key);
  expect(parseCancelRunRequest({ runId: key, expectedRevision: 1 }).expectedRevision).toBe(1);
  expect(() =>
    parseCancelRunRequest({ runId: key, expectedRevision: 1, ownerUserId: "foreign" }),
  ).toThrow("invalid_input");
});
for (const status of ["succeeded", "failed", "interrupted"]) {
  test(`persisted ${status} DTO rejects earlier owner cancellation`, () => {
    const value = {
      id: key,
      revision: 3,
      origin: "interactive",
      botId: "bot",
      conversationId: "chat",
      configurationId: "config",
      configurationVersion: 1,
      status,
      attemptId: key,
      generation: 1,
      effectState: status === "interrupted" ? "uncertain" : "known",
      createdAtMs: 1,
      startedAtMs: 3,
      finishedAtMs: 5,
      cancelRequestedAtMs: 4,
    };
    expect(() => parseRunDto(value)).toThrow("storage_unavailable");
    expect(parseRunDto({ ...value, cancelRequestedAtMs: null }).cancelRequestedAtMs).toBeNull();
    expect(parseRunDto({ ...value, status: "cancelled" }).cancelRequestedAtMs).toBe(4);
    expect(
      parseRunDto({ ...value, status: "running", effectState: "uncertain", finishedAtMs: null })
        .cancelRequestedAtMs,
    ).toBe(4);
  });
}
for (const status of ["succeeded", "failed"]) {
  test(`persisted ${status} result DTO requires a complete result`, () => {
    const value = {
      runId: key,
      attemptId: key,
      generation: 1,
      status,
      effectState: "known",
      finishedAtMs: 5,
      result: null,
    };
    expect(() => parseRunResultDto(value, 10)).toThrow("storage_unavailable");
    expect(
      parseRunResultDto(
        { ...value, result: { version: 1, text: "done", errorCode: null, lastSequence: 3 } },
        10,
      ).result?.lastSequence,
    ).toBe(3);
    for (const permitted of ["cancelled", "interrupted"])
      expect(
        parseRunResultDto({ ...value, status: permitted, effectState: "uncertain" }, 10).result,
      ).toBeNull();
  });
}

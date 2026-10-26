import { expect, test } from "bun:test";
import { z } from "zod";
import { assertNever, HarnessError, parseRunInput, parseCapabilities } from "./harness";
import { createFixtureAdapter } from "./fixture-adapter";
import { defineHostTool, createHostToolGate } from "./host-tools";
import type { HostTool } from "./host-tools";

export const rawInput = {
  context: { actorId: "actor-a", runId: "run-a", attemptId: "attempt-a", botId: "bot-a", conversationId: "chat-a", configurationId: "config-a" },
  prompt: "synthetic", connections: [],
  budgets: { deadlineMs: 1000, maxEvents: 30, maxOutputBytes: 4096, maxToolBytes: 1024, maxToolCalls: 4 },
};
const input = () => parseRunInput(rawInput);
const success = [{ seq: 1, type: "text", text: "hello" }, { seq: 2, type: "terminal", outcome: "succeeded" }];
const collect = async (events: AsyncIterable<unknown>) => Array.fromAsync(events);

test("emits ordered text and one terminal when fixture succeeds", async () => {
  // Given
  const run = createFixtureAdapter(success).start(input(), []);
  // When
  const events = await collect(run.events);
  // Then
  expect(events.map((event) => event)).toMatchObject([
    { sequence: 1, type: "status", status: "running" },
    { sequence: 2, type: "text", text: "hello" },
    { sequence: 3, type: "terminal", outcome: "succeeded" },
  ]);
});

test("rejects unknown capabilities when discovery crosses the boundary", () => {
  // Given
  const capabilities = {
    version: 1, harness: "fixture", resume: { supported: true },
    modelSelection: { supported: true }, modelCatalog: { supported: true }, hostTools: { supported: true },
  } as const;
  // When / Then
  expect(parseCapabilities(capabilities)).toEqual(capabilities);
  expect(() => parseCapabilities({ ...capabilities, harness: "imaginary" })).toThrow("unsupported");
});

const request = (overrides: Record<string, unknown> = {}) => ({ actorId: "actor-a", runId: "run-a", attemptId: "attempt-a", invocationId: "call-1", tool: "echo", arguments: '{"text":"safe"}', ...overrides });
const tool = (execute: (args: { text: string }) => Promise<{ text: string }>) => defineHostTool({ name: "echo", arguments: z.strictObject({ text: z.string() }), result: z.strictObject({ text: z.string() }), execute });
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("not initialized"); };
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const terminal = { seq: 2, type: "terminal", outcome: "succeeded" };

for (const kind of ["callback public denial", "nested validation denial", "custom tool public denial", "custom tool nested denial"] as const) {
  test(`retains uncertain effects when execution throws ${kind}`, async () => {
    // Given
    let effects = 0;
    const nested = tool(async (args) => args);
    const failing: HostTool = (() => {
      switch (kind) {
        case "callback public denial": return tool(async () => { effects++; throw new HarnessError("tool_denied"); });
        case "nested validation denial": return defineHostTool({
          name: "echo", arguments: z.strictObject({ text: z.string() }), result: z.string(),
          async execute(_args, context) { effects++; return nested.execute("{", context, 1024); },
        });
        case "custom tool public denial": return { name: "echo", async execute() { effects++; throw new HarnessError("tool_denied"); } };
        case "custom tool nested denial": return { name: "echo", async execute(_json, context, maxBytes) { effects++; return nested.execute("{", context, maxBytes); } };
        default: return assertNever(kind);
      }
    })();
    const gate = createHostToolGate(input(), [failing], new AbortController().signal);
    const issued = gate.prepare(request());
    // When
    const outcome = await Promise.allSettled([gate.invoke(issued)]);
    // Then
    expect(outcome).toMatchObject([{ status: "rejected", reason: { code: "outcome_uncertain" } }]);
    expect(effects).toBe(1);
    expect(gate.isUncertain()).toBe(true);
  });
}

for (const args of ["{", '{"text":42}']) {
  test(`retains known no-effect denial when arguments are invalid: ${args}`, async () => {
    // Given
    let effects = 0;
    const gate = createHostToolGate(input(), [tool(async (value) => { effects++; return value; })], new AbortController().signal);
    const issued = gate.prepare(request({ arguments: args }));
    // When
    const outcome = await Promise.allSettled([gate.invoke(issued)]);
    // Then
    expect(outcome).toMatchObject([{ status: "rejected", reason: { code: "tool_denied" } }]);
    expect(effects).toBe(0);
    expect(gate.isUncertain()).toBe(false);
  });
}

test("emits one uncertain terminal when callback throws a public denial after an effect", async () => {
  // Given
  let effects = 0;
  let signal: AbortSignal | undefined;
  const failing = defineHostTool({
    name: "echo", arguments: z.strictObject({ text: z.string() }), result: z.string(),
    async execute(_args, context) { effects++; signal = context.signal; throw new HarnessError("tool_denied"); },
  });
  const run = createFixtureAdapter([{ seq: 1, type: "tool", request: request() }, terminal]).start(input(), [failing]);
  // When
  const events = await Array.fromAsync(run.events);
  // Then
  expect(effects).toBe(1);
  expect(events.at(-2)).toMatchObject({ type: "error", code: "outcome_uncertain" });
  expect(events.filter((event) => event.type === "terminal")).toMatchObject([{ outcome: "uncertain" }]);
  expect(events.filter((event) => event.type === "tool_result")).toHaveLength(0);
  expect(signal?.aborted).toBe(true);
});

test("round trips validated host tools when request belongs to the attempt", async () => {
  // Given
  let calls = 0;
  const echo = tool(async (args) => { calls++; return args; });
  const run = createFixtureAdapter([{ seq: 1, type: "tool", request: request() }, terminal]).start(input(), [echo]);
  // When
  const events = await Array.fromAsync(run.events);
  // Then
  expect(events.map((event) => event.type)).toEqual(["status", "tool_request", "tool_result", "terminal"]);
  expect(events[2]).toMatchObject({ result: '{"text":"safe"}', context: rawInput.context });
  expect(calls).toBe(1);
});

for (const override of [{ actorId: "actor-b" }, { runId: "run-b" }, { attemptId: "attempt-b" }, { tool: "missing" }, { arguments: '{"text":42}' }, { arguments: "{" }]) {
  test(`denies substituted or invalid tool request ${JSON.stringify(override)} before effects`, async () => {
    // Given
    let calls = 0;
    const echo = tool(async (args) => { calls++; return args; });
    const run = createFixtureAdapter([{ seq: 1, type: "tool", request: request(override) }, terminal]).start(input(), [echo]);
    // When
    const events = await Array.fromAsync(run.events);
    // Then
    expect(calls).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: "terminal", outcome: "failed" });
    expect(events.at(-2)).toMatchObject({ type: "error", code: "tool_denied" });
  });
}

test("rejects pending duplicates and object forgeries when one invocation is in flight", async () => {
  // Given
  const result = deferred<{ text: string }>();
  let calls = 0;
  const echo = tool(async () => { calls++; return result.promise; });
  const gate = createHostToolGate(input(), [echo], new AbortController().signal);
  const issued = gate.prepare(request());
  const running = gate.invoke(issued);
  // When
  const attempts = await Promise.allSettled([gate.invoke(issued), gate.invoke({ ...issued }), gate.invoke(gate.prepare(request()))]);
  result.resolve({ text: "safe" });
  await running;
  // Then
  expect(attempts.map((attempt) => attempt.status)).toEqual(["rejected", "rejected", "rejected"]);
  expect(calls).toBe(1);
});

test("rejects another gate's issued invocation when actor B substitutes actor A callback", async () => {
  // Given
  let calls = 0;
  const echo = tool(async (args) => { calls++; return args; });
  const a = createHostToolGate(input(), [echo], new AbortController().signal);
  const b = createHostToolGate(parseRunInput({ ...rawInput, context: { ...rawInput.context, actorId: "actor-b" } }), [echo], new AbortController().signal);
  const foreign = a.prepare(request());
  // When / Then
  await expect(b.invoke(foreign)).rejects.toThrow("tool_denied");
  expect(calls).toBe(0);
});

test("retains uncertainty when cancellation interrupts a callback", async () => {
  // Given
  const started = deferred<void>();
  const result = deferred<{ text: string }>();
  const echo = tool(async () => { started.resolve(); return result.promise; });
  const run = createFixtureAdapter([{ seq: 1, type: "tool", request: request() }, terminal]).start(input(), [echo]);
  const collecting = Array.fromAsync(run.events);
  await started.promise;
  // When
  run.cancel();
  const events = await collecting;
  result.resolve({ text: "late success" });
  // Then
  expect(events.at(-1)).toMatchObject({ type: "terminal", outcome: "uncertain" });
  expect(events.filter((event) => event.type === "tool_result")).toHaveLength(0);
});

test("closes admission when cancelled before invocation", async () => {
  // Given
  let calls = 0;
  const controller = new AbortController();
  const gate = createHostToolGate(input(), [tool(async (args) => { calls++; return args; })], controller.signal);
  const issued = gate.prepare(request());
  // When
  controller.abort();
  // Then
  await expect(gate.invoke(issued)).rejects.toThrow("tool_denied");
  expect(() => gate.prepare(request({ invocationId: "call-2" }))).toThrow("tool_denied");
  expect(calls).toBe(0);
});

for (const [name, frames, code] of [
  ["malformed", [{ seq: 1, type: "strange", secret: "not exported" }], "malformed_output"],
  ["out of order", [{ seq: 2, type: "text", text: "bad" }], "out_of_order"],
  ["oversize", [{ seq: 1, type: "text", text: "x".repeat(5000) }], "output_limit"],
  ["failure", [{ seq: 1, type: "failure" }], "adapter_failed"],
  ["double terminal", [{ seq: 1, type: "terminal", outcome: "succeeded" }, terminal], "out_of_order"],
  ["missing terminal", [{ seq: 1, type: "text", text: "partial" }], "malformed_output"],
] as const) {
  test(`emits a bounded failure when ${name} occurs`, async () => {
    // Given
    const run = createFixtureAdapter(frames).start(input(), []);
    // When
    const events = await Array.fromAsync(run.events);
    // Then
    expect(events.at(-2)).toMatchObject({ type: "error", code });
    expect(events.at(-1)).toMatchObject({ type: "terminal", outcome: "failed" });
    expect(events.filter((event) => event.type === "terminal")).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("not exported");
  });
}

test("cancels a paused stream when the owner requests stop", async () => {
  // Given
  const pause = deferred<void>();
  const run = createFixtureAdapter([{ seq: 1, type: "pause" }, terminal], pause.promise).start(input(), []);
  const iterator = run.events[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  // When
  run.cancel();
  const remaining = [];
  for (let next = await iterator.next(); !next.done; next = await iterator.next()) remaining.push(next.value);
  pause.resolve();
  // Then
  expect(remaining.at(-1)).toMatchObject({ type: "terminal", outcome: "cancelled" });
});

test("fails within its finite deadline when a pause never releases", async () => {
  // Given
  const pause = deferred<void>();
  const run = createFixtureAdapter([{ seq: 1, type: "pause" }, terminal], pause.promise).start(parseRunInput({ ...rawInput, budgets: { ...rawInput.budgets, deadlineMs: 5 } }), []);
  // When
  const events = await Array.fromAsync(run.events);
  pause.resolve();
  // Then
  expect(events.at(-2)).toMatchObject({ type: "error", code: "deadline" });
  expect(events.at(-1)).toMatchObject({ type: "terminal", outcome: "failed" });
});

for (const execute of [async () => { throw new Error("private callback detail"); }, async () => ({ text: "x".repeat(2000) })]) {
  test("never promotes an uncertain callback failure to success", async () => {
    // Given
    const run = createFixtureAdapter([{ seq: 1, type: "tool", request: request() }, terminal]).start(input(), [tool(execute)]);
    // When
    const events = await Array.fromAsync(run.events);
    // Then
    expect(events.at(-1)).toMatchObject({ type: "terminal", outcome: "uncertain" });
    expect(JSON.stringify(events)).not.toContain("private callback detail");
  });
}

test("counts UTF8 bytes when multi-byte text exceeds output budget", async () => {
  // Given
  const run = createFixtureAdapter([{ seq: 1, type: "text", text: "😀".repeat(1200) }, terminal]).start(input(), []);
  // When
  const events = await Array.fromAsync(run.events);
  // Then
  expect(events.at(-2)).toMatchObject({ code: "output_limit" });
});

test("preserves Unicode separator characters when object frames contain them", async () => {
  // Given
  const text = "a\u2028b\u2029😀";
  const run = createFixtureAdapter([{ seq: 1, type: "text", text }, terminal]).start(input(), []);
  // When
  const events = await Array.fromAsync(run.events);
  // Then
  expect(events[1]).toMatchObject({ text });
});

for (const value of [{ model: "model-x" }, { resume: { reference: "session-a", ownerActorId: "actor-a" } }]) {
  test("rejects unsupported requested capability without starting a stream", () => {
    // Given
    const adapter = createFixtureAdapter(success);
    // When / Then
    expect(() => adapter.start(parseRunInput({ ...rawInput, ...value }), [])).toThrow("unsupported");
  });
}

for (const changes of [
  { connections: [{ reference: "conn-b", ownerActorId: "actor-b" }] },
  { connections: [{ reference: "conn-a", ownerActorId: "actor-a", secret: "no" }] },
  { resume: { reference: "session-b", ownerActorId: "actor-b" } },
  { budgets: { ...rawInput.budgets, deadlineMs: Infinity } },
]) {
  test("denies foreign, secret-bearing or unbounded input at the boundary", () => {
    // Given / When / Then
    expect(() => parseRunInput({ ...rawInput, ...changes })).toThrow("invalid_input");
  });
}

test("freezes nested context and opaque references when input is parsed", () => {
  // Given
  const raw = { ...rawInput, connections: [{ reference: "conn-a", ownerActorId: "actor-a" }] };
  // When
  const parsed = parseRunInput(raw);
  raw.context.actorId = "actor-b";
  // Then
  expect(String(parsed.context.actorId)).toBe("actor-a");
  expect([parsed, parsed.context, parsed.connections, parsed.connections[0], parsed.budgets].every(Object.isFrozen)).toBe(true);
  raw.context.actorId = "actor-a";
});

test("enforces the event ceiling while reserving failure and terminal slots", async () => {
  // Given
  const run = createFixtureAdapter(success).start(parseRunInput({ ...rawInput, budgets: { ...rawInput.budgets, maxEvents: 3 } }), []);
  // When
  const events = await Array.fromAsync(run.events);
  // Then
  expect(events).toHaveLength(3);
  expect(events.at(-1)).toMatchObject({ outcome: "failed" });
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
});

test("keeps actor B successful when actor A emits malformed output", async () => {
  // Given
  const a = createFixtureAdapter([{ secret: "private" }]).start(input(), []);
  const b = createFixtureAdapter(success).start(parseRunInput({ ...rawInput, context: { ...rawInput.context, actorId: "actor-b", runId: "run-b", attemptId: "attempt-b" } }), []);
  // When
  const [eventsA, eventsB] = await Promise.all([Array.fromAsync(a.events), Array.fromAsync(b.events)]);
  // Then
  expect(eventsA.at(-1)).toMatchObject({ outcome: "failed", context: { actorId: "actor-a" } });
  expect(eventsB.at(-1)).toMatchObject({ outcome: "succeeded", context: { actorId: "actor-b" } });
});

test("denies duplicate completed calls without replaying an effect", async () => {
  // Given
  let calls = 0;
  const echo = tool(async (args) => { calls++; return args; });
  const run = createFixtureAdapter([{ seq: 1, type: "tool", request: request() }, { seq: 2, type: "tool", request: request() }, { ...terminal, seq: 3 }]).start(input(), [echo]);
  // When
  const events = await Array.fromAsync(run.events);
  // Then
  expect(calls).toBe(1);
  expect(events.at(-1)).toMatchObject({ outcome: "failed" });
});

test("denies additional tools when the call budget is exhausted", async () => {
  // Given
  let calls = 0;
  const run = createFixtureAdapter([{ seq: 1, type: "tool", request: request() }, terminal]).start(parseRunInput({ ...rawInput, budgets: { ...rawInput.budgets, maxToolCalls: 0 } }), [tool(async (args) => { calls++; return args; })]);
  // When
  const events = await Array.fromAsync(run.events);
  // Then
  expect(calls).toBe(0);
  expect(events.at(-1)).toMatchObject({ outcome: "failed" });
});

test("denies unknown capability keys in an otherwise valid declaration", () => {
  // Given
  const adapter = createFixtureAdapter(success);
  // When / Then
  expect(() => parseCapabilities({ ...adapter.capabilities, arbitraryTools: { supported: true } })).toThrow("unsupported");
});

test("marks schema-invalid callback results uncertain after execution", async () => {
  // Given
  const invalid = defineHostTool({ name: "echo", arguments: z.strictObject({ text: z.string() }), result: z.strictObject({ text: z.string().max(2) }), execute: async () => ({ text: "invalid" }) });
  const run = createFixtureAdapter([{ seq: 1, type: "tool", request: request() }, terminal]).start(input(), [invalid]);
  // When
  const events = await Array.fromAsync(run.events);
  // Then
  expect(events.at(-1)).toMatchObject({ outcome: "uncertain" });
});

test("resumes a paused fixture when its explicit latch releases", async () => {
  // Given
  const pause = deferred<void>();
  const run = createFixtureAdapter([{ seq: 1, type: "pause" }, terminal], pause.promise).start(input(), []);
  const iterator = run.events[Symbol.asyncIterator]();
  await iterator.next();
  const paused = await iterator.next();
  // When
  pause.resolve();
  const resumed = await iterator.next();
  await iterator.next();
  // Then
  expect(paused.value).toMatchObject({ type: "status", status: "paused" });
  expect(resumed.value).toMatchObject({ type: "terminal", outcome: "succeeded" });
});

test("does not produce a second terminal when cancellation follows completion", async () => {
  // Given
  const run = createFixtureAdapter(success).start(input(), []);
  const events = await Array.fromAsync(run.events);
  // When
  run.cancel();
  const late = await Array.fromAsync(run.events);
  // Then
  expect(events.filter((event) => event.type === "terminal")).toHaveLength(1);
  expect(late).toHaveLength(0);
});

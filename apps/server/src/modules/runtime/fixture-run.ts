import { z } from "zod";
import { createFixtureAdapter } from "./fixture-adapter";
import { parseRunInput } from "./harness";
import { defineHostTool } from "./host-tools";

/** Explicit offline verification entry point; importing this module performs no work. */
export async function runFixtureVerification() {
  const input = parseRunInput({
    context: { actorId: "actor-a", runId: "run-a", attemptId: "attempt-a", botId: "bot-a", conversationId: "chat-a", configurationId: "config-a" },
    prompt: "synthetic", connections: [],
    budgets: { deadlineMs: 1000, maxEvents: 20, maxOutputBytes: 4096, maxToolBytes: 1024, maxToolCalls: 2 },
  });
  let effects = 0;
  let callbackSignal: AbortSignal | undefined;
  const echo = defineHostTool({
    name: "echo", arguments: z.strictObject({ text: z.string() }), result: z.strictObject({ text: z.string() }),
    async execute(args, context) { effects++; callbackSignal = context.signal; return args; },
  });
  const request = { actorId: "actor-a", runId: "run-a", attemptId: "attempt-a", invocationId: "call-1", tool: "echo", arguments: '{"text":"synthetic"}' };
  const run = createFixtureAdapter([
    { seq: 1, type: "text", text: "synthetic" }, { seq: 2, type: "tool", request },
    { seq: 3, type: "terminal", outcome: "succeeded" },
  ]).start(input, [echo]);
  const events = await Array.fromAsync(run.events);
  const malformed = await Array.fromAsync(createFixtureAdapter([{ seq: 4, type: "text", text: "synthetic" }]).start(input, []).events);
  const denied = await Array.fromAsync(createFixtureAdapter([{ seq: 1, type: "tool", request: { ...request, actorId: "actor-b" } }]).start(input, [echo]).events);
  const cancelled = createFixtureAdapter([{ seq: 1, type: "terminal", outcome: "succeeded" }]).start(input, []);
  cancelled.cancel();
  const stopped = await Array.fromAsync(cancelled.events);
  const last = events.at(-1);
  const checks = {
    ordered: events.every((event, index) => event.sequence === index + 1),
    roundTrip: events.some((event) => event.type === "tool_result" && event.result === '{"text":"synthetic"}'),
    success: last?.type === "terminal" && last.outcome === "succeeded",
    terminalOnce: events.filter((event) => event.type === "terminal").length === 1,
    foreignDenied: denied.some((event) => event.type === "error" && event.code === "tool_denied") && effects === 1,
    orderRejected: malformed.some((event) => event.type === "error" && event.code === "out_of_order"),
    cancelled: stopped.some((event) => event.type === "terminal" && event.outcome === "cancelled"),
    cleanup: callbackSignal?.aborted === true,
  };
  return Object.freeze({ scope: "synthetic-contract-only", checks, passed: Object.values(checks).every(Boolean) });
}

if (import.meta.main) {
  const receipt = await runFixtureVerification();
  console.log(JSON.stringify(receipt));
  process.exitCode = receipt.passed ? 0 : 1;
}

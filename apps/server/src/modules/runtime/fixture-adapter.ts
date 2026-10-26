import { z } from "zod";
import { assertNever, HarnessError, parseCapabilities, parseRunInput } from "./harness";
import type { EventPayload, HarnessAdapter, HarnessEvent, RunInput } from "./harness";
import { boundedText, createHostToolGate } from "./host-tools";
import type { HostTool } from "./host-tools";

const sequence = z.number().int().positive();
const stepSchema = z.discriminatedUnion("type", [
  z.strictObject({ seq: sequence, type: z.literal("text"), text: z.string() }),
  z.strictObject({ seq: sequence, type: z.literal("tool"), request: z.unknown() }),
  z.strictObject({ seq: sequence, type: z.literal("pause") }),
  z.strictObject({ seq: sequence, type: z.literal("failure") }),
  z.strictObject({ seq: sequence, type: z.literal("terminal"), outcome: z.enum(["succeeded", "failed", "uncertain"]) }),
]);
const capabilities = parseCapabilities({
  version: 1, harness: "fixture", resume: { supported: false, reason: "not_implemented" },
  modelSelection: { supported: false, reason: "not_implemented" },
  modelCatalog: { supported: false, reason: "not_implemented" }, hostTools: { supported: true },
});

/** Cancellation bounds waiting, not external side effects. The supervisor must reconcile those. */
async function interruptible<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new HarnessError("deadline");
  let onAbort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new HarnessError("deadline"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

/** Synthetic object frames only. Native byte framing, transport and command construction belong to adapters. */
export function createFixtureAdapter(frames: readonly unknown[], pause: Promise<void> = Promise.resolve()): HarnessAdapter<HostTool> {
  const script = [...frames];
  return Object.freeze({ capabilities, start(rawInput: RunInput, tools: readonly HostTool[]) {
    const input = parseRunInput(rawInput);
    if (input.resume || input.model) throw new HarnessError("unsupported");
    const controller = new AbortController();
    const gate = createHostToolGate(input, tools, controller.signal);
    let cancelled = false;
    const cancel = () => { cancelled = true; controller.abort(); };
    return Object.freeze({ events: execute(input, script, pause, gate, controller, () => cancelled), cancel });
  } });
}

type Gate = ReturnType<typeof createHostToolGate>;
async function* execute(input: RunInput, script: readonly unknown[], pause: Promise<void>, gate: Gate,
  controller: AbortController, cancelled: () => boolean): AsyncGenerator<HarnessEvent> {
  let sequenceNumber = 0;
  let outputBytes = 0;
  const timer = setTimeout(() => controller.abort(), input.budgets.deadlineMs);
  function event(payload: EventPayload): HarnessEvent {
    sequenceNumber += 1;
    return Object.freeze({ ...payload, sequence: sequenceNumber, context: input.context });
  }
  function dataEvent(payload: EventPayload): HarnessEvent {
    if (sequenceNumber >= input.budgets.maxEvents - 2) throw new HarnessError("output_limit");
    outputBytes += new TextEncoder().encode(JSON.stringify(payload)).length;
    if (outputBytes > input.budgets.maxOutputBytes) throw new HarnessError("output_limit");
    return event(payload);
  }
  try {
    if (controller.signal.aborted) throw new HarnessError("deadline");
    yield dataEvent({ type: "status", status: "running" });
    for (const [index, raw] of script.entries()) {
      if (controller.signal.aborted) throw new HarnessError("deadline");
      const parsed = stepSchema.safeParse(raw);
      if (!parsed.success) throw new HarnessError("malformed_output");
      const step = parsed.data;
      if (step.seq !== index + 1) throw new HarnessError("out_of_order");
      switch (step.type) {
        case "text": yield dataEvent({ type: "text", text: boundedText(step.text, input.budgets.maxOutputBytes) }); break;
        case "pause":
          yield dataEvent({ type: "status", status: "paused" });
          await interruptible(pause, controller.signal);
          break;
        case "tool": {
          const invocation = gate.prepare(step.request);
          yield dataEvent({ type: "tool_request", invocationId: invocation.invocationId, tool: invocation.tool });
          if (controller.signal.aborted) throw new HarnessError("deadline");
          const result = await interruptible(gate.invoke(invocation), controller.signal);
          yield dataEvent({ type: "tool_result", invocationId: invocation.invocationId, result });
          break;
        }
        case "failure": throw new HarnessError("adapter_failed");
        case "terminal":
          if (index !== script.length - 1) throw new HarnessError("out_of_order");
          if (gate.isUncertain()) throw new HarnessError("outcome_uncertain");
          yield event({ type: "terminal", outcome: step.outcome });
          return;
        default: assertNever(step);
      }
    }
    throw new HarnessError("malformed_output");
  } catch (error) {
    // no-excuse-ok: catch -- fixture/transport failures export fixed diagnostics, never raw output.
    const uncertain = gate.isUncertain();
    const code = uncertain ? "outcome_uncertain" : error instanceof HarnessError ? error.code : "adapter_failed";
    yield event({ type: "error", code });
    yield event({ type: "terminal", outcome: uncertain ? "uncertain" : cancelled() ? "cancelled" : "failed" });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

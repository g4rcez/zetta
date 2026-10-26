import { z } from "zod";
import { HarnessError } from "./harness";
import type { RunContext, RunInput } from "./harness";

const requestSchema = z.strictObject({
  actorId: z.string(), runId: z.string(), attemptId: z.string(),
  invocationId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  tool: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), arguments: z.string(),
}).readonly();
export type HostInvocation = z.infer<typeof requestSchema>;
export type ToolContext = Readonly<{ context: RunContext; invocationId: string; signal: AbortSignal }>;
export interface HostTool {
  readonly name: string;
  readonly execute: (json: string, context: ToolContext, maxBytes: number) => Promise<string>;
}
class InvalidToolArguments extends HarnessError {
  constructor() { super("tool_denied"); }
}
const validatedTools = new WeakSet<HostTool>();
export function boundedText(value: string, limit: number): string {
  if (value.length > limit || new TextEncoder().encode(value).length > limit) throw new HarnessError("output_limit");
  return value;
}
function parseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch (error) { if (error instanceof SyntaxError) throw new InvalidToolArguments(); throw error; }
}
function encodeJson(value: unknown): string {
  // no-excuse-ok: catch -- callback output is an untrusted boundary; never expose thrown details.
  try {
    const result = JSON.stringify(value);
    if (result === undefined) throw new HarnessError("outcome_uncertain");
    return result;
  } catch { throw new HarnessError("outcome_uncertain"); }
}
export function defineHostTool<A, R>(options: Readonly<{
  name: string; arguments: z.ZodType<A>; result: z.ZodType<R>;
  execute: (args: A, context: ToolContext) => Promise<R>;
}>): HostTool {
  const tool = Object.freeze({ name: options.name, async execute(json: string, context: ToolContext, maxBytes: number) {
    const args = options.arguments.safeParse(parseJson(boundedText(json, maxBytes)));
    if (!args.success) throw new InvalidToolArguments();
    // no-excuse-ok: catch -- execution may have effects even when it forwards a nested validation denial.
    try {
      const raw = await options.execute(args.data, context);
      const result = options.result.safeParse(raw);
      if (!result.success) throw new HarnessError("outcome_uncertain");
      return boundedText(encodeJson(result.data), maxBytes);
    } catch { throw new HarnessError("outcome_uncertain"); }
  } });
  validatedTools.add(tool);
  return tool;
}

/** One gate per attempt. Transport authenticates its channel before calling prepare.
 * Implementations reauthorize resource access immediately before effects; references are not authority.
 */
export function createHostToolGate(input: RunInput, tools: readonly HostTool[], signal: AbortSignal) {
  const issued = new WeakSet<HostInvocation>();
  const claimed = new Set<string>();
  const registry = new Map<string, HostTool>();
  for (const tool of tools) {
    if (registry.has(tool.name)) throw new HarnessError("invalid_input");
    registry.set(tool.name, tool);
  }
  let pending = 0;
  let uncertain = false;
  function prepare(raw: unknown): HostInvocation {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) throw new HarnessError("tool_denied");
    const request = parsed.data;
    if (signal.aborted || request.actorId !== input.context.actorId || request.runId !== input.context.runId
      || request.attemptId !== input.context.attemptId || !registry.has(request.tool)) throw new HarnessError("tool_denied");
    boundedText(request.arguments, input.budgets.maxToolBytes);
    issued.add(request);
    return request;
  }
  async function invoke(request: HostInvocation): Promise<string> {
    const tool = registry.get(request.tool);
    if (signal.aborted || !issued.has(request) || claimed.has(request.invocationId) || !tool
      || claimed.size >= input.budgets.maxToolCalls) throw new HarnessError("tool_denied");
    claimed.add(request.invocationId);
    pending += 1;
    try {
      const result = await tool.execute(request.arguments, Object.freeze({ context: input.context, invocationId: request.invocationId, signal }), input.budgets.maxToolBytes);
      if (signal.aborted) throw new HarnessError("outcome_uncertain");
      return result;
    } catch (error) {
      // no-excuse-ok: catch -- unknown callback failure may follow a completed external effect.
      if (validatedTools.has(tool) && error instanceof InvalidToolArguments) throw new HarnessError("tool_denied");
      uncertain = true;
      throw new HarnessError("outcome_uncertain");
    } finally { pending -= 1; }
  }
  return Object.freeze({ prepare, invoke, isUncertain: () => uncertain || pending > 0 });
}

import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const runContextSchema = z.strictObject({
  actorId: id.brand<"ActorId">(), runId: id.brand<"RunId">(), attemptId: id.brand<"AttemptId">(),
  botId: id.brand<"BotId">(), conversationId: id.brand<"ConversationId">(), configurationId: id.brand<"ConfigurationId">(),
  routineId: id.brand<"RoutineId">().optional(), delegationId: id.brand<"DelegationId">().optional(),
}).readonly();
export type RunContext = z.infer<typeof runContextSchema>;
const connectionSchema = z.strictObject({ reference: id.brand<"ConnectionRef">(), ownerActorId: id.brand<"ActorId">() }).readonly();
const sessionSchema = z.strictObject({ reference: id.brand<"SessionRef">(), ownerActorId: id.brand<"ActorId">() }).readonly();
const budgetsSchema = z.strictObject({
  deadlineMs: z.number().int().min(1).max(60_000), maxEvents: z.number().int().min(3).max(1000),
  maxOutputBytes: z.number().int().min(1).max(1_048_576), maxToolBytes: z.number().int().min(1).max(65_536),
  maxToolCalls: z.number().int().min(0).max(100),
}).readonly();
const runInputSchema = z.strictObject({
  context: runContextSchema, prompt: z.string().max(65_536),
  connections: z.array(connectionSchema).max(32).readonly(), budgets: budgetsSchema,
  resume: sessionSchema.optional(), model: id.optional(),
}).superRefine((value, ctx) => {
  if (value.connections.some((connection) => connection.ownerActorId !== value.context.actorId)
    || (value.resume && value.resume.ownerActorId !== value.context.actorId)) {
    ctx.addIssue({ code: "custom", message: "Foreign reference" });
  }
}).readonly();
export type RunInput = z.infer<typeof runInputSchema>;

const support = z.discriminatedUnion("supported", [
  z.strictObject({ supported: z.literal(true) }).readonly(),
  z.strictObject({ supported: z.literal(false), reason: z.enum(["not_implemented", "not_available", "unverified"]) }).readonly(),
]);
const capabilitiesSchema = z.strictObject({
  version: z.literal(1), harness: z.enum(["fixture", "pi", "codex", "omp", "claude-code", "opencode", "cursor"]),
  resume: support, modelSelection: support, modelCatalog: support, hostTools: support,
}).readonly();
export type HarnessCapabilities = z.infer<typeof capabilitiesSchema>;
export type HarnessErrorCode = "invalid_input" | "unsupported" | "malformed_output" | "out_of_order" | "output_limit" | "tool_denied" | "tool_failed" | "outcome_uncertain" | "deadline" | "adapter_failed";
export class HarnessError extends Error {
  constructor(public readonly code: HarnessErrorCode) { super(code); }
}

/** Trusted callers derive ownership first. Parsing checks shape, never grants authorization. */
export function parseRunInput(value: unknown): RunInput {
  const parsed = runInputSchema.safeParse(value);
  if (!parsed.success) throw new HarnessError("invalid_input");
  return parsed.data;
}
export function parseCapabilities(value: unknown): HarnessCapabilities {
  const parsed = capabilitiesSchema.safeParse(value);
  if (!parsed.success) throw new HarnessError("unsupported");
  return parsed.data;
}
export type TerminalOutcome = "succeeded" | "failed" | "cancelled" | "uncertain";
export type EventPayload =
  | Readonly<{ type: "status"; status: "running" | "paused" }>
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "tool_request"; invocationId: string; tool: string }>
  | Readonly<{ type: "tool_result"; invocationId: string; result: string }>
  | Readonly<{ type: "error"; code: HarnessErrorCode }>
  | Readonly<{ type: "terminal"; outcome: TerminalOutcome }>;
export type HarnessEvent = EventPayload & Readonly<{ context: RunContext; sequence: number }>;
export interface HarnessRun {
  readonly events: AsyncIterable<HarnessEvent>;
  readonly cancel: () => void;
}
export interface HarnessAdapter<Tool> {
  readonly capabilities: HarnessCapabilities;
  readonly start: (input: RunInput, tools: readonly Tool[]) => HarnessRun;
}
export function assertNever(_value: never): never { throw new HarnessError("malformed_output"); }

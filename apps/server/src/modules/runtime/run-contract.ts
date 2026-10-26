import { z } from "zod";
import { parseRunInput, type RunInput } from "./harness";

export class RunBoundaryError extends Error {
  constructor(readonly code: "invalid_input" | "unsupported" | "storage_unavailable" | "stale_attempt" | "stale_revision" | "transition_conflict") {
    super(code);
    this.name = "RunBoundaryError";
  }
}
export function runFail(code: RunBoundaryError["code"]): never { throw new RunBoundaryError(code); }
export const runIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const runUuidSchema = z.uuid().refine(value => value === value.toLowerCase());
export const runCounterSchema = z.number().int().min(1).max(2147483647);
export const runEpochSchema = z.number().int().safe().refine(value => Number.isFinite(new Date(value).getTime()));
export const runStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]);
export const runEffectSchema = z.enum(["no_effect", "known", "uncertain"]);
const text = z.string().max(65536).refine(value => value.isWellFormed() && !value.includes("\0") && Buffer.byteLength(value, "utf8") <= 65536);
const budgets = z.strictObject({
  deadlineMs: z.number().int().min(1).max(60000), maxEvents: z.number().int().min(3).max(1000),
  maxOutputBytes: z.number().int().min(1).max(1048576), maxToolBytes: z.number().int().min(1).max(65536),
  maxToolCalls: z.number().int().min(0).max(100),
}).readonly();
const connection = z.strictObject({ reference: runIdSchema, credentialVersion: runCounterSchema }).readonly();
const origin = z.enum(["interactive", "setup"]);
const harness = z.enum(["fixture", "pi", "codex", "omp", "claude-code", "opencode", "cursor"]);
const input = z.strictObject({
  prompt: text, harness, model: runIdSchema.nullable().optional().transform(value => value ?? null), budgets,
  connections: z.array(connection).max(32).refine(values => new Set(values.map(value => value.reference)).size === values.length).readonly(),
  resumeReference: runIdSchema.nullable().optional().transform(value => value ?? null),
}).readonly();
const submit = z.strictObject({
  requestKey: runUuidSchema, origin, botId: runIdSchema, conversationId: runIdSchema,
  configurationId: runIdSchema, configurationVersion: runCounterSchema, input,
}).readonly();
export type SubmitRequest = z.infer<typeof submit>;
function encode(value: SubmitRequest): string {
  const { input: i } = value;
  const b = i.budgets;
  return JSON.stringify(["zetta.run.input", 1, value.requestKey, value.origin, value.botId, value.conversationId,
    value.configurationId, value.configurationVersion, i.prompt, i.harness, i.model,
    [b.deadlineMs, b.maxEvents, b.maxOutputBytes, b.maxToolBytes, b.maxToolCalls],
    i.connections.map(c => [c.reference, c.credentialVersion]), i.resumeReference]);
}
export function parseSubmitRequest(value: unknown): SubmitRequest {
  const parsed = submit.safeParse(value);
  if (!parsed.success) return runFail("invalid_input");
  if (Buffer.byteLength(encode(parsed.data), "utf8") > 98304) return runFail("invalid_input");
  const i = parsed.data.input;
  if (i.harness !== "fixture" || i.connections.length !== 0 || i.resumeReference !== null) return runFail("unsupported");
  return parsed.data;
}
export function canonicalRunInput(value: unknown): string { return encode(parseSubmitRequest(value)); }
const snapshot = z.tuple([
  z.literal("zetta.run.input"), z.literal(1), runUuidSchema, origin, runIdSchema, runIdSchema, runIdSchema, runCounterSchema,
  text, harness, runIdSchema.nullable(), z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
  z.array(z.tuple([runIdSchema, runCounterSchema])).max(32), runIdSchema.nullable(),
]);
export function decodeRunInput(value: unknown): SubmitRequest {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 98304) return runFail("invalid_input");
  let json: unknown;
  try { json = JSON.parse(value); } catch { return runFail("invalid_input"); }
  const parsed = snapshot.safeParse(json);
  if (!parsed.success) return runFail("invalid_input");
  const [, , requestKey, origin, botId, conversationId, configurationId, configurationVersion, prompt, harness, model, b, refs, resumeReference] = parsed.data;
  const request = parseSubmitRequest({ requestKey, origin, botId, conversationId, configurationId, configurationVersion,
    input: { prompt, harness, model, resumeReference, connections: refs.map(([reference, credentialVersion]) => ({ reference, credentialVersion })),
      budgets: { deadlineMs: b[0], maxEvents: b[1], maxOutputBytes: b[2], maxToolBytes: b[3], maxToolCalls: b[4] } } });
  if (encode(request) !== value) return runFail("invalid_input");
  return request;
}
const contextIdentity = z.strictObject({ actorId: runIdSchema, runId: runUuidSchema, attemptId: runUuidSchema });
export function toHarnessInput(value: unknown, trustedIdentity: unknown): RunInput {
  const request = parseSubmitRequest(value);
  const identity = contextIdentity.safeParse(trustedIdentity);
  if (!identity.success) return runFail("invalid_input");
  return parseRunInput({ context: { ...identity.data, botId: request.botId, conversationId: request.conversationId, configurationId: request.configurationId },
    prompt: request.input.prompt, connections: [], budgets: request.input.budgets,
    ...(request.input.model === null ? {} : { model: request.input.model }) });
}
const dto = z.strictObject({
  id: runUuidSchema, revision: runCounterSchema, origin, botId: runIdSchema, conversationId: runIdSchema,
  configurationId: runIdSchema, configurationVersion: runCounterSchema, status: runStatusSchema,
  attemptId: runUuidSchema, generation: runCounterSchema, effectState: runEffectSchema,
  createdAtMs: runEpochSchema, startedAtMs: runEpochSchema.nullable(), finishedAtMs: runEpochSchema.nullable(), cancelRequestedAtMs: runEpochSchema.nullable(),
}).refine(v => (v.status === "queued" || v.status === "running") === (v.finishedAtMs === null))
  .refine(v => [v.startedAtMs, v.finishedAtMs, v.cancelRequestedAtMs].every(t => t === null || t >= v.createdAtMs))
  .refine(v => v.startedAtMs === null || v.finishedAtMs === null || v.finishedAtMs >= v.startedAtMs)
  .refine(v => v.status !== "queued" || (v.startedAtMs === null && v.cancelRequestedAtMs === null && v.effectState === "no_effect"))
  .refine(v => v.status !== "running" || v.effectState !== "known")
  .refine(v => !["succeeded", "failed"].includes(v.status) || v.effectState === "known")
  .refine(v => v.status !== "interrupted" || v.effectState === "uncertain")
  .refine(v => v.finishedAtMs === null || v.cancelRequestedAtMs === null || v.finishedAtMs >= v.cancelRequestedAtMs)
  .refine(v => v.cancelRequestedAtMs === null || v.status === "running" || v.status === "cancelled")
  .readonly();
export type RunDto = z.infer<typeof dto>;
export function parseRunDto(value: unknown): RunDto {
  const parsed = dto.safeParse(value);
  return parsed.success ? parsed.data : runFail("storage_unavailable");
}
export const runResultSchema = z.strictObject({
  version: z.literal(1), text, lastSequence: z.number().int().min(0).max(1000),
  errorCode: z.enum(["invalid_input", "unsupported", "malformed_output", "out_of_order", "output_limit", "tool_denied", "tool_failed", "outcome_uncertain", "deadline", "adapter_failed"]).nullable(),
}).readonly();
export type RunResult = z.infer<typeof runResultSchema>;
export function parseRunResult(value: unknown, maxEvents: number): RunResult {
  const parsed = runResultSchema.safeParse(value);
  if (!Number.isInteger(maxEvents) || maxEvents < 3 || maxEvents > 1000 || !parsed.success || parsed.data.lastSequence > maxEvents) return runFail("storage_unavailable");
  return parsed.data;
}
const resultDto = z.strictObject({ runId: runUuidSchema, attemptId: runUuidSchema, generation: runCounterSchema,
  status: z.enum(["succeeded", "failed", "cancelled", "interrupted"]), effectState: runEffectSchema,
  finishedAtMs: runEpochSchema, result: runResultSchema.nullable(),
}).refine(v => !["succeeded", "failed"].includes(v.status) || (v.effectState === "known" && v.result !== null))
  .refine(v => v.status !== "interrupted" || v.effectState === "uncertain").readonly();
export type RunResultDto = z.infer<typeof resultDto>;
export function parseRunResultDto(value: unknown, maxEvents: number): RunResultDto {
  const parsed = resultDto.safeParse(value);
  if (!parsed.success || !Number.isInteger(maxEvents) || maxEvents < 3 || maxEvents > 1000) return runFail("storage_unavailable");
  if (parsed.data.result !== null) parseRunResult(parsed.data.result, maxEvents);
  return parsed.data;
}
const read = z.strictObject({ runId: runUuidSchema }).readonly();
const cancel = z.strictObject({ runId: runUuidSchema, expectedRevision: runCounterSchema }).readonly();
export function parseOwnedRunRequest(value: unknown) {
  const parsed = read.safeParse(value);
  return parsed.success ? parsed.data : runFail("invalid_input");
}
export function parseCancelRunRequest(value: unknown) {
  const parsed = cancel.safeParse(value);
  return parsed.success ? parsed.data : runFail("invalid_input");
}

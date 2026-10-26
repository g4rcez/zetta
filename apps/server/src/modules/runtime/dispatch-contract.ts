import { createHash } from "node:crypto";
import { z } from "zod";
import { runCounterSchema, runEpochSchema, runIdSchema, runUuidSchema } from "./run-contract";

export class DispatchError extends Error {
  readonly name = "DispatchError";
  constructor(readonly code: "invalid_action" | "invalid_grant" | "invalid_capacity" | "stale_revision" | "identity_mismatch" | "transition_conflict" | "deadline_denied") { super(code); }
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const inputSequence = runCounterSchema.max(65537);
const activation = z.tuple([z.literal("activate"), runUuidSchema, digest]).readonly();
const input = z.tuple([z.literal("input"), runUuidSchema, inputSequence, z.number().int().min(0).max(8192), z.boolean(), digest])
  .refine(value => (value[3] > 0 || value[4]) && value[2] - 1 + value[3] <= 65536).readonly();
const binding = {
  version: z.literal(1), ownerUserId: runIdSchema, runId: runUuidSchema, attemptId: runUuidSchema, generation: runCounterSchema,
  leaseId: runUuidSchema, actionId: runUuidSchema, launcherInstallationId: runIdSchema, policyVersion: runIdSchema,
  receiptId: runUuidSchema, connectionId: z.null(), credentialVersion: z.null(), expiresAtMs: runEpochSchema,
};
const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...binding, kind: z.literal("activate"), sequence: z.literal(1), descriptor: activation }),
  z.strictObject({ ...binding, kind: z.literal("input"), sequence: inputSequence, descriptor: input }),
]).refine(value => value.actionId === value.descriptor[1] && (value.kind !== "input" || value.sequence === value.descriptor[2])).readonly();
export type DispatchAction = z.infer<typeof actionSchema>;
function encode(a: DispatchAction): string {
  return JSON.stringify(["zetta.dispatch.action", 1, a.ownerUserId, a.runId, a.attemptId, a.generation, a.leaseId, a.actionId,
    a.launcherInstallationId, a.policyVersion, a.receiptId, a.kind, a.sequence, a.connectionId, a.credentialVersion, a.expiresAtMs, a.descriptor]);
}
export function parseDispatchAction(raw: unknown): DispatchAction {
  const result = actionSchema.safeParse(raw);
  if (!result.success || Buffer.byteLength(encode(result.data), "utf8") > 16384) throw new DispatchError("invalid_action");
  return result.data;
}
export function canonicalDispatchAction(raw: unknown): string { return encode(parseDispatchAction(raw)); }
export function digestDispatchAction(raw: unknown): string { return createHash("sha256").update(canonicalDispatchAction(raw), "utf8").digest("hex"); }
const canonicalSchema = z.tuple([z.literal("zetta.dispatch.action"), z.literal(1), runIdSchema, runUuidSchema, runUuidSchema,
  runCounterSchema, runUuidSchema, runUuidSchema, runIdSchema, runIdSchema, runUuidSchema, z.enum(["activate", "input"]),
  runCounterSchema, z.null(), z.null(), runEpochSchema, z.union([activation, input])]);
export function decodeDispatchAction(raw: unknown): DispatchAction {
  if (typeof raw !== "string" || !raw.isWellFormed() || Buffer.byteLength(raw, "utf8") > 16384) throw new DispatchError("invalid_action");
  let json: unknown;
  try { json = JSON.parse(raw); } catch (error) {
    if (error instanceof SyntaxError) throw new DispatchError("invalid_action");
    throw error;
  }
  const parsed = canonicalSchema.safeParse(json);
  if (!parsed.success) throw new DispatchError("invalid_action");
  const [, version, ownerUserId, runId, attemptId, generation, leaseId, actionId, launcherInstallationId, policyVersion, receiptId, kind, sequence, connectionId, credentialVersion, expiresAtMs, descriptor] = parsed.data;
  const action = parseDispatchAction({ version, ownerUserId, runId, attemptId, generation, leaseId, actionId, launcherInstallationId, policyVersion,
    receiptId, kind, sequence, connectionId, credentialVersion, expiresAtMs, descriptor });
  if (encode(action) !== raw) throw new DispatchError("invalid_action");
  return action;
}
const inputBinding = z.strictObject(binding);
const inputFrame = z.strictObject({ bytes: z.instanceof(Uint8Array).refine(value => value.byteLength <= 8192), sequence: inputSequence, eof: z.boolean() });
export function createInputDispatchAction(rawBinding: unknown, rawFrame: unknown): Extract<DispatchAction, { kind: "input" }> {
  const identity = inputBinding.safeParse(rawBinding), frame = inputFrame.safeParse(rawFrame);
  if (!identity.success || !frame.success) throw new DispatchError("invalid_action");
  const bytes = Uint8Array.from(frame.data.bytes);
  const action = parseDispatchAction({ ...identity.data, kind: "input", sequence: frame.data.sequence,
    descriptor: ["input", identity.data.actionId, frame.data.sequence, bytes.byteLength, frame.data.eof, createHash("sha256").update(bytes).digest("hex")] });
  switch (action.kind) {
    case "input": return action;
    case "activate": throw new DispatchError("invalid_action");
    default: return unreachable(action);
  }
}
function unreachable(_value: never): never { throw new DispatchError("invalid_action"); }

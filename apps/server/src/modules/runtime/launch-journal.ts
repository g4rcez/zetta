import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";
import type { FixtureLaunchPolicy, FixtureLaunchRecipe } from "./launch-recipe";
import { LaunchSpecError, parseLaunchSpec, parseStoredLaunchSpec } from "./launch-spec";
import type { LaunchAdmission, LaunchSpec } from "./launch-spec";

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = integer.min(1), digest = z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema = z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), sequence: positive, byteLength: integer.max(8192), eof: z.boolean() }).readonly();
const operationSchema = z.strictObject({ id: z.uuid(), sequence: positive, type: z.enum(["create", "start", "input", "stop", "remove"]), input: inputSchema.nullable() })
  .refine(value => (value.type === "input") === (value.input !== null)).readonly();
export type JournalOperation = z.infer<typeof operationSchema>;
const recordSchema = z.strictObject({
  version: z.literal(1), receiptId: z.uuid().brand<"LaunchReceiptId">(), policy: z.unknown(), spec: z.unknown(),
  specDigest: digest, identityDigest: digest, ownershipDigest: digest,
  containerName: z.string().max(64), ownershipLabel: digest, runnerUnitId: z.string().max(80), containerId: digest.nullable(),
  phase: z.enum(["intent", "creating", "prepared", "starting", "running", "stopping", "stopped", "quarantined"]),
  pendingOperation: operationSchema.nullable(), lastOperation: z.strictObject({ operation: operationSchema, factDigest: digest }).readonly().nullable(), operationSequence: integer,
  cancelIntent: z.enum(["owner", "deadline", "revocation", "shutdown", "recovery"]).nullable(),
  lastInput: inputSchema.nullable(), inputBytes: integer.max(65536), outcomeUncertain: z.boolean(),
  terminal: z.enum(["none", "not_started", "process_stopped"]), cleanup: z.enum(["pending", "unknown", "confirmed"]), observedAtEpochMs: positive,
}).readonly();
export type LaunchJournal = Readonly<Omit<z.infer<typeof recordSchema>, "spec" | "policy"> & { spec: LaunchSpec; policy: FixtureLaunchPolicy }>;
export class LaunchJournalError extends Error {
  readonly name = "LaunchJournalError";
  constructor(readonly code: "invalid_journal" | "identity_mismatch" | "invalid_operation" | "operation_conflict" | "admission_closed" | "invalid_transition" | "clock_denied") { super(code); }
}

export function journalDigest(tuple: readonly unknown[]): string { return createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex"); }
export function parseJournalOperation(raw: unknown): JournalOperation {
  const result = operationSchema.safeParse(raw);
  if (!result.success) throw new LaunchJournalError("invalid_operation");
  return result.data;
}
function ownershipDigest(record: Readonly<{ receiptId: string; identityDigest: string; containerName: string; ownershipLabel: string; runnerUnitId: string }>): string {
  return journalDigest(["zetta.launch.ownership", 1, record.receiptId, record.identityDigest, record.containerName, record.ownershipLabel, record.runnerUnitId]);
}

function stateValid(r: LaunchJournal): boolean {
  const pending = r.pendingOperation, last = r.lastOperation;
  if (r.operationSequence !== (pending?.sequence ?? last?.operation.sequence ?? 0)) return false;
  if (pending && last && (pending.sequence !== last.operation.sequence + 1 || pending.id === last.operation.id)) return false;
  if (pending && !last && pending.sequence !== 1) return false;
  if (last && r.containerId === null) return false;
  if (r.containerId !== null && last === null) return false;
  for (const op of [pending, last?.operation]) {
    if (!op) continue;
    if ((op.type === "create" && op.sequence !== 1) || (op.type === "start" && op.sequence !== 2)
      || (op.input && op.sequence !== op.input.sequence + 2)) return false;
  }
  if (pending?.type === "create" && (last !== null || r.containerId !== null)) return false;
  if (pending?.type === "start" && last?.operation.type !== "create") return false;
  if (pending?.type === "input" && last?.operation.type !== "start" && last?.operation.type !== "input") return false;
  if (pending?.type === "stop" && (!last || last.operation.type === "stop" || last.operation.type === "remove")) return false;
  if (pending?.type === "remove" && last?.operation.type !== "stop") return false;
  const factTypes = { create: "created_verified", start: "started", input: "input_written", stop: "stopped", remove: "removed" } as const;
  if (last && last.factDigest !== journalDigest([factTypes[last.operation.type], r.containerId, r.containerName, r.ownershipLabel, r.identityDigest])) return false;
  if (r.inputBytes > r.spec.budgets.maxInputBytes || (r.lastInput === null ? r.inputBytes !== 0 : r.lastInput.byteLength > r.inputBytes)) return false;
  if (r.lastInput && (r.lastInput.byteLength > r.spec.budgets.maxFrameBytes || (!r.lastInput.eof && r.lastInput.byteLength === 0))) return false;
  if (r.lastInput && (r.containerId === null || r.lastInput.sequence > r.operationSequence - 2
    || r.inputBytes < r.lastInput.sequence - (r.lastInput.eof ? 1 : 0) || r.inputBytes > r.lastInput.sequence * r.spec.budgets.maxFrameBytes)) return false;
  if (pending?.input && journalDigest([pending.input]) !== journalDigest([r.lastInput])) return false;
  if (last?.operation.input && !pending?.input && journalDigest([last.operation.input]) !== journalDigest([r.lastInput])) return false;
  if (r.cleanup === "confirmed" && (r.phase !== "stopped" || pending !== null || r.terminal === "none")) return false;
  if (r.cleanup === "unknown" && !r.outcomeUncertain) return false;
  if (r.outcomeUncertain && r.cancelIntent === null) return false;
  if (r.terminal === "not_started" && (r.operationSequence !== 0 || r.containerId !== null || r.cleanup !== "confirmed")) return false;
  if (r.terminal === "process_stopped" && r.containerId === null) return false;
  if (r.terminal === "process_stopped" && last?.operation.type !== "stop" && last?.operation.type !== "remove") return false;
  if (last?.operation.type === "stop" && r.terminal !== "process_stopped") return false;
  if (last?.operation.type === "remove" && r.cleanup !== "confirmed") return false;
  if (r.cleanup === "confirmed" && r.terminal === "process_stopped" && last?.operation.type !== "remove") return false;
  if (r.phase === "quarantined" && (!r.outcomeUncertain || r.cancelIntent === null)) return false;
  switch (r.phase) {
    case "intent": return r.operationSequence === 0 && r.containerId === null && r.terminal === "none" && r.cancelIntent === null && r.cleanup === "pending";
    case "creating": return pending?.type === "create" && last === null && r.containerId === null && r.terminal === "none" && r.lastInput === null;
    case "prepared": return pending === null && last?.operation.type === "create" && r.containerId !== null && r.terminal === "none" && r.cancelIntent === null && r.lastInput === null;
    case "starting": return pending?.type === "start" && last?.operation.type === "create" && r.containerId !== null && r.terminal === "none" && r.cancelIntent === null;
    case "running": return (pending === null || pending.type === "input") && (last?.operation.type === "start" || last?.operation.type === "input") && r.containerId !== null && r.terminal === "none" && r.cancelIntent === null;
    case "stopping": return r.terminal === "none" && r.cancelIntent !== null && r.containerId !== null && (pending === null || pending.type === "stop" || pending.type === "start" || pending.type === "input");
    case "stopped": return r.cancelIntent !== null && (r.terminal === "not_started" || (r.terminal === "process_stopped" && (last?.operation.type === "stop" || last?.operation.type === "remove"))) && (pending === null || pending.type === "remove");
    case "quarantined": return true;
    default: return unreachable(r.phase);
  }
}

export function parseLaunchJournal(raw: unknown, trusted: Readonly<{ policy: FixtureLaunchPolicy; receiptId?: string }>): LaunchJournal {
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) throw new LaunchJournalError("invalid_journal");
  try {
    const record = Object.freeze({ ...parsed.data, spec: parseStoredLaunchSpec(parsed.data.spec), policy: createFixtureLaunchPolicy(parsed.data.policy) });
    if (record.policy.installationId !== trusted.policy.installationId || record.policy.image !== trusted.policy.image
      || record.policy.policyVersion !== trusted.policy.policyVersion || (trusted.receiptId !== undefined && record.receiptId !== trusted.receiptId)) throw new LaunchJournalError("identity_mismatch");
    const recipe = expandFixtureRecipe(record.spec, trusted.policy);
    if (record.specDigest !== recipe.specDigest || record.identityDigest !== recipe.identityDigest || record.ownershipDigest !== ownershipDigest(record)
      || record.containerName !== `zetta-${record.receiptId}` || record.runnerUnitId !== `zetta-attempt@${record.receiptId}.service` || !stateValid(record)) throw new LaunchJournalError("invalid_journal");
    return record;
  } catch (error) {
    if (error instanceof LaunchSpecError) throw new LaunchJournalError("invalid_journal");
    throw error;
  }
}

export function createLaunchJournal(recipe: FixtureLaunchRecipe, admission: LaunchAdmission): LaunchJournal {
  const spec = parseLaunchSpec(recipe.spec, admission);
  const policy = createFixtureLaunchPolicy({ installationId: recipe.installationId, policyVersion: recipe.policyVersion, image: recipe.container.Image });
  const receiptId = randomUUID();
  const identity = { receiptId, identityDigest: recipe.identityDigest, containerName: `zetta-${receiptId}`, ownershipLabel: randomBytes(32).toString("hex"), runnerUnitId: `zetta-attempt@${receiptId}.service` };
  return parseLaunchJournal({ ...identity, version: 1, policy, spec, specDigest: recipe.specDigest, ownershipDigest: ownershipDigest(identity), containerId: null,
    phase: "intent", pendingOperation: null, lastOperation: null, operationSequence: 0, cancelIntent: null, lastInput: null, inputBytes: 0,
    terminal: "none", cleanup: "pending", outcomeUncertain: false, observedAtEpochMs: admission.nowEpochMs,
  }, { policy });
}

function unreachable(_value: never): never { throw new LaunchJournalError("invalid_journal"); }

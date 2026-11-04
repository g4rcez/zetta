import { z } from "zod";
import {
  canonicalDispatchAction,
  decodeDispatchAction,
  DispatchError,
  parseDispatchAction,
} from "./dispatch-contract";
import {
  runCounterSchema,
  runEpochSchema,
  runIdSchema,
  runStatusSchema,
  runUuidSchema,
} from "./run-contract";
import { isRunTerminal } from "./run-state";

const grantSchema = z
  .strictObject({
    id: runUuidSchema,
    canonicalAction: z.string().max(16384),
    revision: runCounterSchema,
    state: z.enum(["pending", "issued", "cancelled", "expired", "uncertain"]),
    deliveryOutcome: z.enum(["not_attempted", "acknowledged", "unknown"]),
    createdAtMs: runEpochSchema,
    updatedAtMs: runEpochSchema,
    issuedAtMs: runEpochSchema.nullable(),
    cancelledAtMs: runEpochSchema.nullable(),
  })
  .readonly();
export type DispatchGrant = z.infer<typeof grantSchema>;
export type DispatchGrantDraft = Readonly<{ grant: DispatchGrant; newAdmission: boolean }>;
export function parseDispatchGrant(raw: unknown): DispatchGrant {
  const parsed = grantSchema.safeParse(raw);
  if (!parsed.success) throw new DispatchError("invalid_grant");
  const g = parsed.data,
    a = decodeDispatchAction(g.canonicalAction);
  if (
    g.updatedAtMs < g.createdAtMs ||
    a.expiresAtMs <= g.createdAtMs ||
    a.expiresAtMs - g.createdAtMs > 30000 ||
    [g.issuedAtMs, g.cancelledAtMs].some(
      (t) => t !== null && (t < g.createdAtMs || t > g.updatedAtMs),
    ) ||
    (g.issuedAtMs !== null &&
      (g.issuedAtMs >= a.expiresAtMs ||
        (g.cancelledAtMs !== null && g.cancelledAtMs < g.issuedAtMs)))
  )
    throw new DispatchError("invalid_grant");
  switch (g.state) {
    case "pending":
      if (
        g.issuedAtMs !== null ||
        g.cancelledAtMs !== null ||
        g.deliveryOutcome !== "not_attempted"
      )
        throw new DispatchError("invalid_grant");
      break;
    case "issued":
      if (g.issuedAtMs === null || g.deliveryOutcome === "unknown")
        throw new DispatchError("invalid_grant");
      break;
    case "uncertain":
      if (g.deliveryOutcome === "not_attempted") throw new DispatchError("invalid_grant");
      break;
    case "cancelled":
      if (
        g.cancelledAtMs === null ||
        g.issuedAtMs !== null ||
        g.deliveryOutcome !== "not_attempted"
      )
        throw new DispatchError("invalid_grant");
      break;
    case "expired":
      if (
        g.updatedAtMs < a.expiresAtMs ||
        g.issuedAtMs !== null ||
        g.cancelledAtMs !== null ||
        g.deliveryOutcome !== "not_attempted"
      )
        throw new DispatchError("invalid_grant");
      break;
    default:
      return unreachable(g.state);
  }
  return g;
}
const admissionSchema = z.strictObject({
  id: runUuidSchema,
  nowMs: runEpochSchema,
  attemptDeadlineMs: runEpochSchema,
});
export function createDispatchGrant(rawAction: unknown, rawAdmission: unknown): DispatchGrant {
  const a = parseDispatchAction(rawAction),
    parsed = admissionSchema.safeParse(rawAdmission);
  if (!parsed.success) throw new DispatchError("invalid_grant");
  const t = parsed.data;
  if (
    a.expiresAtMs <= t.nowMs ||
    a.expiresAtMs - t.nowMs > 30000 ||
    a.expiresAtMs > t.attemptDeadlineMs ||
    t.attemptDeadlineMs - t.nowMs > 60000
  )
    throw new DispatchError("deadline_denied");
  return parseDispatchGrant({
    id: t.id,
    canonicalAction: canonicalDispatchAction(a),
    revision: 1,
    state: "pending",
    deliveryOutcome: "not_attempted",
    createdAtMs: t.nowMs,
    updatedAtMs: t.nowMs,
    issuedAtMs: null,
    cancelledAtMs: null,
  });
}
const tokenSchema = z.strictObject({
  id: runUuidSchema,
  canonicalAction: z.string().max(16384),
  expectedRevision: runCounterSchema,
});
const factSchema = z.strictObject({
  type: z.enum(["issue", "ack", "unknown", "cancel", "expire"]),
  atMs: runEpochSchema,
});
export type DispatchGrantFact = z.infer<typeof factSchema>;
const draft = (grant: DispatchGrant, newAdmission = false): DispatchGrantDraft =>
  Object.freeze({ grant, newAdmission });

// Pure admission drafts confer no transaction provenance or permission to perform I/O.
export function transitionDispatchGrant(
  raw: unknown,
  rawToken: unknown,
  rawFact: unknown,
): DispatchGrantDraft {
  const g = parseDispatchGrant(raw),
    token = tokenSchema.safeParse(rawToken),
    fact = factSchema.safeParse(rawFact);
  if (!token.success || !fact.success) throw new DispatchError("invalid_grant");
  const t = token.data,
    f = fact.data;
  if (t.id !== g.id || t.canonicalAction !== g.canonicalAction)
    throw new DispatchError("identity_mismatch");
  if (t.expectedRevision !== g.revision) throw new DispatchError("stale_revision");
  if (f.atMs < g.updatedAtMs) throw new DispatchError("transition_conflict");
  const action = decodeDispatchAction(g.canonicalAction);
  let patch: Partial<DispatchGrant>;
  let newAdmission = false;
  switch (f.type) {
    case "issue":
      if (g.state !== "pending") return draft(g);
      if (f.atMs >= action.expiresAtMs) throw new DispatchError("deadline_denied");
      patch = { state: "issued", issuedAtMs: f.atMs };
      newAdmission = true;
      break;
    case "ack":
      if (g.state !== "issued" && g.state !== "uncertain")
        throw new DispatchError("transition_conflict");
      if (g.deliveryOutcome === "acknowledged") return draft(g);
      patch = { deliveryOutcome: "acknowledged" };
      break;
    case "unknown":
      if (g.deliveryOutcome === "acknowledged" || g.state === "cancelled" || g.state === "expired")
        throw new DispatchError("transition_conflict");
      if (g.state === "uncertain") return draft(g);
      patch = { state: "uncertain", deliveryOutcome: "unknown" };
      break;
    case "cancel":
      if (g.cancelledAtMs !== null || g.state === "expired") return draft(g);
      patch = {
        cancelledAtMs: f.atMs,
        ...(g.state === "pending" ? { state: "cancelled" as const } : {}),
      };
      break;
    case "expire":
      if (f.atMs < action.expiresAtMs) throw new DispatchError("deadline_denied");
      if (g.state !== "pending") return draft(g);
      patch = { state: "expired" };
      break;
    default:
      return unreachable(f.type);
  }
  if (g.revision === 2147483647) throw new DispatchError("transition_conflict");
  return draft(
    parseDispatchGrant({ ...g, ...patch, revision: g.revision + 1, updatedAtMs: f.atMs }),
    newAdmission,
  );
}
const policySchema = z
  .strictObject({
    version: z.literal(1),
    launcherInstallationId: runIdSchema,
    policyVersion: runIdSchema,
    globalLimit: z.literal(2),
    actorLimit: z.literal(1),
  })
  .readonly();
const claimSchema = z
  .strictObject({
    attemptId: runUuidSchema,
    runId: runUuidSchema,
    ownerUserId: runIdSchema,
    generation: runCounterSchema,
    leaseId: runUuidSchema,
    claimOperationId: runUuidSchema,
    launcherInstallationId: runIdSchema,
    policyVersion: runIdSchema,
    revision: runCounterSchema,
    createdAtMs: runEpochSchema,
    deadlineAtMs: runEpochSchema,
    leaseExpiresAtMs: runEpochSchema,
    releasedAtMs: runEpochSchema.nullable(),
    logicalStatus: runStatusSchema,
    resourceState: z.enum([
      "not_submitted",
      "prepare_pending",
      "prepared",
      "active",
      "stopping",
      "unknown",
      "cleaned",
    ]),
    cleanup: z.enum(["unconfirmed", "confirmed"]),
    pendingOperationId: runUuidSchema.nullable(),
  })
  .readonly();
export type DispatchCapacityClaim = z.infer<typeof claimSchema>;
export type DispatchCapacityProjection = Readonly<{
  globalOccupied: number;
  actorOccupied: number;
  canClaim: boolean;
}>;

// These structural facts require authoritative DB/launcher provenance at the later integration boundary.
export function projectDispatchCapacity(
  rawPolicy: unknown,
  rawClaims: unknown,
  rawOwner: unknown,
): DispatchCapacityProjection {
  const policy = policySchema.safeParse(rawPolicy),
    claims = z.array(claimSchema).max(1024).safeParse(rawClaims),
    owner = runIdSchema.safeParse(rawOwner);
  if (!policy.success || !claims.success || !owner.success)
    throw new DispatchError("invalid_capacity");
  const attempts = new Set<string>(),
    operations = new Set<string>();
  let globalOccupied = 0,
    actorOccupied = 0;
  for (const c of claims.data) {
    if (
      attempts.has(c.attemptId) ||
      operations.has(c.claimOperationId) ||
      c.launcherInstallationId !== policy.data.launcherInstallationId ||
      c.policyVersion !== policy.data.policyVersion ||
      c.deadlineAtMs <= c.createdAtMs ||
      c.deadlineAtMs - c.createdAtMs > 60000 ||
      c.leaseExpiresAtMs <= c.createdAtMs ||
      c.leaseExpiresAtMs > c.deadlineAtMs ||
      (c.resourceState === "not_submitted" && c.pendingOperationId !== null) ||
      (c.resourceState === "prepare_pending" && c.pendingOperationId === null) ||
      (c.cleanup === "confirmed" &&
        (c.pendingOperationId !== null ||
          (c.resourceState !== "cleaned" && c.resourceState !== "not_submitted"))) ||
      (c.resourceState === "cleaned" && c.cleanup !== "confirmed") ||
      (c.releasedAtMs !== null &&
        (c.releasedAtMs < c.createdAtMs ||
          !isRunTerminal(c.logicalStatus) ||
          c.cleanup !== "confirmed" ||
          c.pendingOperationId !== null))
    )
      throw new DispatchError("invalid_capacity");
    attempts.add(c.attemptId);
    operations.add(c.claimOperationId);
    if (c.releasedAtMs === null) {
      globalOccupied++;
      if (c.ownerUserId === owner.data) actorOccupied++;
    }
  }
  return Object.freeze({
    globalOccupied,
    actorOccupied,
    canClaim: globalOccupied < policy.data.globalLimit && actorOccupied < policy.data.actorLimit,
  });
}
function unreachable(_value: never): never {
  throw new DispatchError("transition_conflict");
}

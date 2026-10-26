import { z } from "zod";
import { decodeDispatchLaunchSpec } from "./dispatch-launch-codec";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";
import { runCounterSchema, runEpochSchema, runIdSchema, runUuidSchema } from "./run-contract";
import type { readRunRows } from "./run-rows";
import { isRunTerminal } from "./run-state";

export class DispatchClaimRowsError extends Error {
  constructor() { super("invalid_claim"); this.name = "DispatchClaimRowsError"; }
}
const fail = (): never => { throw new DispatchClaimRowsError(); };
const instant = z.instanceof(Date).refine(value => runEpochSchema.safeParse(value.getTime()).success).transform(value => value.getTime());
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.strictObject({
  attemptId: runUuidSchema, runId: runUuidSchema, ownerUserId: runIdSchema, generation: runCounterSchema,
  leaseId: runUuidSchema, claimOperationId: runUuidSchema, launcherInstallationId: runIdSchema, policyVersion: runIdSchema,
  launchSpecVersion: z.literal(1), launchSpecCanonical: z.string(), launchSpecDigest: digest, launchIdentityDigest: digest,
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), deadlineAt: instant, receiptId: runUuidSchema.nullable(), prepareIntentAt: instant.nullable(),
  resourceState: z.enum(["not_submitted", "prepare_pending", "prepared", "active", "stopping", "unknown", "cleaned"]),
  pendingOperationId: runUuidSchema.nullable(), pendingOperationKind: z.enum(["prepare", "activate", "input", "stop", "remove"]).nullable(),
  cleanupKind: z.enum(["not_submitted", "removed"]).nullable(), cleanupConfirmedAt: instant.nullable(),
  cancelReason: z.enum(["owner", "deadline", "revocation", "shutdown", "recovery"]).nullable(), cancelRequestedAt: instant.nullable(),
  releasedAt: instant.nullable(), revision: runCounterSchema, createdAt: instant, updatedAt: instant,
}).readonly();
type Claim = z.infer<typeof schema>;
function validateFacts(c: Claim): void {
  if (c.updatedAt < c.createdAt || c.deadlineAt <= c.createdAt || c.deadlineAt - c.createdAt > 60000
    || [c.prepareIntentAt, c.cleanupConfirmedAt, c.cancelRequestedAt, c.releasedAt].some(t => t !== null && (t < c.createdAt || t > c.updatedAt))
    || (c.pendingOperationId === null) !== (c.pendingOperationKind === null)
    || (c.cleanupKind === null) !== (c.cleanupConfirmedAt === null)
    || (c.cancelReason === null) !== (c.cancelRequestedAt === null)) fail();
  if ((c.resourceState === "not_submitted" && (c.prepareIntentAt !== null || c.receiptId !== null || c.pendingOperationId !== null))
    || (c.resourceState !== "not_submitted" && c.prepareIntentAt === null)
    || (c.receiptId !== null && c.prepareIntentAt === null)
    || (["prepared", "active", "stopping", "cleaned"].includes(c.resourceState) && c.receiptId === null)
    || (c.resourceState === "prepare_pending" && (c.pendingOperationKind !== "prepare" || c.receiptId !== null))
    || (c.pendingOperationKind !== null && c.pendingOperationKind !== "prepare" && c.receiptId === null)) fail();
  if ((c.cleanupKind !== null && c.pendingOperationId !== null)
    || (c.cleanupKind === "not_submitted" && (c.resourceState !== "not_submitted" || c.prepareIntentAt !== null || c.receiptId !== null))
    || (c.cleanupKind === "removed" && (c.resourceState !== "cleaned" || c.receiptId === null || c.prepareIntentAt === null))
    || (c.resourceState === "cleaned" && c.cleanupKind !== "removed")
    || (c.releasedAt !== null && (c.cleanupConfirmedAt === null || c.cleanupKind === null || c.pendingOperationId !== null || c.releasedAt < c.cleanupConfirmedAt))
    || (c.cancelReason === "deadline" && (c.cancelRequestedAt === null || c.cancelRequestedAt < c.deadlineAt))) fail();
  if (c.revision === 1 && (c.updatedAt !== c.createdAt || c.resourceState !== "not_submitted"
    || [c.prepareIntentAt, c.receiptId, c.pendingOperationId, c.cleanupKind, c.cancelReason, c.releasedAt].some(v => v !== null))) fail();
}
/** Structural historical read only. Membership, producer provenance and fresh admission remain separate obligations. */
export function readDispatchClaim(raw: unknown, current: ReturnType<typeof readRunRows>, rawPolicy: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail();
  const claim = parsed.data;
  validateFacts(claim);
  const { run, attempt, input } = current, payload = input.input;
  if (claim.attemptId !== attempt.id || claim.runId !== run.id || claim.ownerUserId !== run.ownerUserId
    || claim.generation !== attempt.generation || claim.generation !== run.currentGeneration || claim.leaseId !== attempt.leaseId
    || claim.createdAt !== attempt.claimedAt || attempt.leaseExpiresAt === null || attempt.leaseExpiresAt > claim.deadlineAt
    || claim.deadlineAt - claim.createdAt !== payload.budgets.deadlineMs
    || payload.harness !== "fixture" || payload.model !== null || payload.connections.length !== 0 || payload.resumeReference !== null
    || payload.budgets.maxToolCalls !== 0 || payload.budgets.maxOutputBytes > 65536 || Buffer.byteLength(payload.prompt, "utf8") > 65536
    || (claim.cancelReason === "owner" && claim.cancelRequestedAt !== run.cancelRequestedAt)
    || (claim.releasedAt !== null && (!isRunTerminal(attempt.status) || attempt.finishedAt === null || claim.releasedAt < attempt.finishedAt))
    || (claim.cleanupKind === "not_submitted" && (attempt.startedAt !== null || attempt.effectState !== "no_effect"))) return fail();
  try {
    const spec = decodeDispatchLaunchSpec(claim.launchSpecCanonical), policy = createFixtureLaunchPolicy(rawPolicy);
    const c = spec.context, b = spec.budgets, recipe = expandFixtureRecipe(spec, policy);
    if (c.actorId !== run.ownerUserId || c.runId !== run.id || c.attemptId !== attempt.id || c.botId !== run.botId
      || c.conversationId !== run.conversationId || c.configurationId !== run.configurationId || c.routineId !== undefined || c.delegationId !== undefined
      || spec.leaseId !== claim.leaseId || spec.fence !== claim.generation || spec.recipe !== "fixture-v1" || spec.fixtureCase !== "echo"
      || spec.deadlineEpochMs !== claim.deadlineAt || b.deadlineMs !== payload.budgets.deadlineMs || b.maxInputBytes !== 65536
      || b.maxOutputBytes !== payload.budgets.maxOutputBytes || b.maxFrameBytes !== Math.min(8192, 65536, payload.budgets.maxOutputBytes)
      || claim.launcherInstallationId !== policy.installationId || claim.policyVersion !== policy.policyVersion || claim.imageDigest !== policy.image
      || claim.launchSpecDigest !== recipe.specDigest || claim.launchIdentityDigest !== recipe.identityDigest) return fail();
    return Object.freeze({ claim, spec });
  } catch { return fail(); }
}

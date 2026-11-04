import { z } from "zod";
import {
  parseRunResult,
  runCounterSchema,
  runEffectSchema,
  runEpochSchema,
  runFail,
  runResultSchema,
  runStatusSchema,
  runUuidSchema,
} from "./run-contract";

const stateSchema = z
  .strictObject({
    runId: runUuidSchema,
    attemptId: runUuidSchema,
    generation: runCounterSchema,
    revision: runCounterSchema,
    status: runStatusSchema,
    effectState: runEffectSchema,
    maxEvents: z.number().int().min(3).max(1000),
    leaseId: runUuidSchema.nullable(),
    leaseExpiresAtMs: runEpochSchema.nullable(),
    createdAtMs: runEpochSchema,
    claimedAtMs: runEpochSchema.nullable(),
    startedAtMs: runEpochSchema.nullable(),
    finishedAtMs: runEpochSchema.nullable(),
    cancelRequestedAtMs: runEpochSchema.nullable(),
    stopConfirmedAtMs: runEpochSchema.nullable(),
    cancellationReason: z.literal("owner_requested").nullable(),
    result: runResultSchema.nullable(),
  })
  .readonly();
export type RunState = z.infer<typeof stateSchema>;
export function isRunTerminal(status: RunState["status"]): boolean {
  return status !== "queued" && status !== "running";
}
export function parseRunState(value: unknown): RunState {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) return runFail("storage_unavailable");
  const s = parsed.data;
  const leased = s.leaseId !== null;
  if (
    leased !== (s.claimedAtMs !== null) ||
    leased !== (s.leaseExpiresAtMs !== null) ||
    isRunTerminal(s.status) !== (s.finishedAtMs !== null) ||
    (s.cancelRequestedAtMs !== null) !== (s.cancellationReason !== null) ||
    (s.cancelRequestedAtMs !== null && s.status !== "running" && s.status !== "cancelled") ||
    (s.status === "running" && !leased) ||
    (s.status === "queued" &&
      (leased ||
        s.startedAtMs !== null ||
        s.stopConfirmedAtMs !== null ||
        s.cancelRequestedAtMs !== null ||
        s.effectState !== "no_effect")) ||
    (!isRunTerminal(s.status) && (s.result !== null || s.effectState === "known")) ||
    (["succeeded", "failed"].includes(s.status) &&
      (s.effectState !== "known" || s.result === null)) ||
    (s.status === "interrupted" && s.effectState !== "uncertain") ||
    (!leased && s.status === "cancelled" && (s.effectState !== "no_effect" || s.result !== null)) ||
    (!leased &&
      (s.startedAtMs !== null ||
        s.stopConfirmedAtMs !== null ||
        (s.status !== "queued" && s.status !== "cancelled"))) ||
    (s.startedAtMs !== null && s.effectState === "no_effect")
  )
    return runFail("storage_unavailable");
  for (const time of [
    s.claimedAtMs,
    s.startedAtMs,
    s.finishedAtMs,
    s.cancelRequestedAtMs,
    s.stopConfirmedAtMs,
  ])
    if (time !== null && time < s.createdAtMs) return runFail("storage_unavailable");
  const claimed = s.claimedAtMs;
  const started = s.startedAtMs;
  if (
    claimed !== null &&
    (s.leaseExpiresAtMs === null ||
      s.leaseExpiresAtMs <= claimed ||
      [started, s.finishedAtMs, s.stopConfirmedAtMs].some((t) => t !== null && t < claimed))
  )
    return runFail("storage_unavailable");
  if (
    started !== null &&
    [s.finishedAtMs, s.stopConfirmedAtMs].some((t) => t !== null && t < started)
  )
    return runFail("storage_unavailable");
  if (
    s.cancelRequestedAtMs !== null &&
    s.finishedAtMs !== null &&
    s.finishedAtMs < s.cancelRequestedAtMs
  )
    return runFail("storage_unavailable");
  if (s.result !== null) parseRunResult(s.result, s.maxEvents);
  return s;
}
const tokenSchema = z.strictObject({
  runId: runUuidSchema,
  attemptId: runUuidSchema,
  generation: runCounterSchema,
  leaseId: runUuidSchema.nullable(),
  expectedRevision: runCounterSchema,
});
export type RunTransitionToken = z.infer<typeof tokenSchema>;
const eventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("cancel"), atMs: runEpochSchema }),
  z.strictObject({ type: z.literal("cancelled_before_admission"), atMs: runEpochSchema }),
  z.strictObject({
    type: z.literal("claimed"),
    atMs: runEpochSchema,
    leaseId: runUuidSchema,
    leaseExpiresAtMs: runEpochSchema,
  }),
  z.strictObject({ type: z.literal("admitted"), atMs: runEpochSchema }),
  z.strictObject({
    type: z.literal("completed"),
    atMs: runEpochSchema,
    outcome: z.enum(["succeeded", "failed", "cancelled", "uncertain"]),
    result: runResultSchema,
  }),
  z.strictObject({
    type: z.literal("lost"),
    atMs: runEpochSchema,
    reason: z.enum(["crash", "lost_protocol", "lease_expired"]),
  }),
  z.strictObject({ type: z.literal("stopped"), atMs: runEpochSchema }),
]);
export type RunBackendFact = z.infer<typeof eventSchema>;
function terminalPatch(s: RunState, fact: Extract<RunBackendFact, { type: "completed" | "lost" }>) {
  if (fact.type === "lost")
    return {
      status: s.cancelRequestedAtMs === null ? "interrupted" : "cancelled",
      effectState: "uncertain",
      result: null,
      finishedAtMs: fact.atMs,
    };
  const result = parseRunResult(fact.result, s.maxEvents);
  return {
    status:
      s.cancelRequestedAtMs !== null
        ? "cancelled"
        : fact.outcome === "uncertain"
          ? "interrupted"
          : fact.outcome,
    effectState: fact.outcome === "uncertain" ? "uncertain" : "known",
    result,
    finishedAtMs: fact.atMs,
  };
}
export function transitionRun(value: unknown, identity: unknown, event: unknown): RunState {
  const s = parseRunState(value);
  const token = tokenSchema.safeParse(identity);
  const fact = eventSchema.safeParse(event);
  if (!token.success || !fact.success) return runFail("invalid_input");
  const t = token.data;
  const f = fact.data;
  if (
    t.runId !== s.runId ||
    t.attemptId !== s.attemptId ||
    t.generation !== s.generation ||
    t.leaseId !== s.leaseId
  )
    return runFail("stale_attempt");
  if (isRunTerminal(s.status)) {
    if (f.type === "cancel") return s;
    if (f.type === "cancelled_before_admission") {
      if (
        s.status === "cancelled" &&
        s.leaseId !== null &&
        s.effectState === "no_effect" &&
        s.startedAtMs === null &&
        s.result === null &&
        s.stopConfirmedAtMs === null
      )
        return s;
      return runFail("transition_conflict");
    }
    if (f.type === "completed" || f.type === "lost") {
      const p = terminalPatch(s, f);
      if (
        p.status === s.status &&
        p.effectState === s.effectState &&
        JSON.stringify(p.result) === JSON.stringify(s.result)
      )
        return s;
      return runFail("transition_conflict");
    }
  }
  if (f.type === "stopped" && s.stopConfirmedAtMs !== null) return s;
  if (s.revision !== t.expectedRevision) return runFail("stale_revision");
  if (s.revision === 2147483647) return runFail("transition_conflict");
  if (
    [
      s.createdAtMs,
      s.claimedAtMs,
      s.startedAtMs,
      s.cancelRequestedAtMs,
      s.finishedAtMs,
      s.stopConfirmedAtMs,
    ].some((time) => time !== null && f.atMs < time)
  )
    return runFail("invalid_input");
  let patch: Partial<RunState>;
  switch (f.type) {
    case "cancel":
      if (s.cancelRequestedAtMs !== null) return s;
      patch = {
        cancelRequestedAtMs: f.atMs,
        cancellationReason: "owner_requested",
        ...(s.status === "queued" ? { status: "cancelled", finishedAtMs: f.atMs } : {}),
      };
      break;
    case "cancelled_before_admission":
      // Trusted service must prove locked absence of prepare, grants and resource operations.
      if (
        s.status !== "running" ||
        s.leaseId === null ||
        s.effectState !== "no_effect" ||
        s.startedAtMs !== null ||
        s.result !== null ||
        s.stopConfirmedAtMs !== null
      )
        return runFail("transition_conflict");
      patch = { status: "cancelled", effectState: "no_effect", finishedAtMs: f.atMs, result: null };
      break;
    case "claimed":
      if (s.status !== "queued" || f.leaseExpiresAtMs <= f.atMs)
        return runFail("transition_conflict");
      patch = {
        status: "running",
        leaseId: f.leaseId,
        leaseExpiresAtMs: f.leaseExpiresAtMs,
        claimedAtMs: f.atMs,
      };
      break;
    case "admitted":
      if (
        s.status !== "running" ||
        s.startedAtMs !== null ||
        s.stopConfirmedAtMs !== null ||
        s.cancelRequestedAtMs !== null ||
        s.leaseExpiresAtMs === null ||
        f.atMs >= s.leaseExpiresAtMs
      )
        return runFail("transition_conflict");
      patch = { startedAtMs: f.atMs, effectState: "uncertain" };
      break;
    case "completed":
    case "lost":
      if (s.status !== "running") return runFail("transition_conflict");
      return parseRunState({ ...s, ...terminalPatch(s, f), revision: s.revision + 1 });
    case "stopped":
      if (s.leaseId === null) return runFail("transition_conflict");
      patch = { stopConfirmedAtMs: f.atMs };
      break;
  }
  return parseRunState({ ...s, ...patch, revision: s.revision + 1 });
}

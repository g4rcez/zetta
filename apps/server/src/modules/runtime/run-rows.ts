import { z } from "zod";
import type { runs, runAttempts } from "@zetta/db/schema/runs";
import { decodeRunInput, parseRunDto, parseRunResult, parseRunResultDto, runCounterSchema, runEffectSchema, runEpochSchema,
  runFail, runIdSchema, runStatusSchema, runUuidSchema, type RunResult } from "./run-contract";
import { isRunTerminal, parseRunState, type RunState } from "./run-state";

export class RunStoreError extends Error {
  constructor(readonly code: "not_found" | "request_conflict" | "result_pending" | "outcome_unknown") { super(code); this.name = "RunStoreError"; }
}
const instant = z.instanceof(Date).refine(value => runEpochSchema.safeParse(value.getTime()).success).transform(value => value.getTime());
const runSchema = z.strictObject({
  id: runUuidSchema, ownerUserId: runIdSchema, requestKey: runUuidSchema, originKind: z.enum(["interactive", "setup"]),
  botId: runIdSchema, conversationId: runIdSchema, configurationId: runIdSchema, configurationVersion: runCounterSchema,
  inputVersion: z.literal(1), inputSnapshot: z.string(), createdAt: instant, revision: runCounterSchema,
  producerKind: z.literal("fixture").nullable(), producerVersion: z.literal(1).nullable(), actorActivationRevision: runCounterSchema.nullable(),
  status: runStatusSchema, currentGeneration: runCounterSchema, cancelRequestedAt: instant.nullable(), startedAt: instant.nullable(), finishedAt: instant.nullable(),
}).refine(value => (value.producerKind === null && value.producerVersion === null && value.actorActivationRevision === null)
  || (value.producerKind !== null && value.producerVersion !== null && value.actorActivationRevision !== null)).readonly();
const attemptSchema = z.strictObject({
  id: runUuidSchema, runId: runUuidSchema, ownerUserId: runIdSchema, generation: runCounterSchema, createdAt: instant,
  status: runStatusSchema, effectState: runEffectSchema, leaseId: runUuidSchema.nullable(), leaseExpiresAt: instant.nullable(),
  claimedAt: instant.nullable(), startedAt: instant.nullable(), finishedAt: instant.nullable(), stopConfirmedAt: instant.nullable(),
  resultVersion: z.number().nullable(), resultText: z.string().nullable(), resultErrorCode: z.string().nullable(), resultLastSequence: z.number().nullable(),
  cancellationReason: z.literal("owner_requested").nullable(),
}).readonly();
function parseStoredRun(value: unknown) {
  const parsed = runSchema.safeParse(value);
  if (!parsed.success) return runFail("storage_unavailable");
  const run = parsed.data;
  let input;
  try { input = decodeRunInput(run.inputSnapshot); } catch { return runFail("storage_unavailable"); }
  const finished = run.finishedAt;
  if (input.requestKey !== run.requestKey || input.origin !== run.originKind || input.botId !== run.botId
    || input.conversationId !== run.conversationId || input.configurationId !== run.configurationId || input.configurationVersion !== run.configurationVersion
    || isRunTerminal(run.status) !== (run.finishedAt !== null)
    || [run.cancelRequestedAt, run.startedAt, run.finishedAt].some(t => t !== null && t < run.createdAt)
    || (run.status === "queued" && (run.startedAt !== null || run.cancelRequestedAt !== null))
    || (run.cancelRequestedAt !== null && run.status !== "running" && run.status !== "cancelled")
    || (finished !== null && [run.startedAt, run.cancelRequestedAt].some(t => t !== null && t > finished))) return runFail("storage_unavailable");
  return { run, input };
}
function parseStoredAttempt(raw: unknown, run: z.infer<typeof runSchema>, maxEvents: number) {
  const parsed = attemptSchema.safeParse(raw);
  if (!parsed.success) return runFail("storage_unavailable");
  const a = parsed.data;
  if (a.runId !== run.id || a.ownerUserId !== run.ownerUserId || a.generation > run.currentGeneration || a.createdAt < run.createdAt) return runFail("storage_unavailable");
  const absent = [a.resultVersion, a.resultText, a.resultErrorCode, a.resultLastSequence].every(value => value === null);
  const result: RunResult | null = absent ? null : parseRunResult({ version: a.resultVersion, text: a.resultText, errorCode: a.resultErrorCode, lastSequence: a.resultLastSequence }, maxEvents);
  const leased = a.leaseId !== null, terminal = isRunTerminal(a.status);
  if (leased !== (a.claimedAt !== null) || leased !== (a.leaseExpiresAt !== null) || terminal !== (a.finishedAt !== null)
    || (a.status === "running" && !leased) || (!terminal && (result !== null || a.effectState === "known"))
    || (a.status === "queued" && (leased || a.startedAt !== null || a.stopConfirmedAt !== null || a.cancellationReason !== null || a.effectState !== "no_effect"))
    || (["succeeded", "failed"].includes(a.status) && (a.effectState !== "known" || result === null))
    || (a.status === "interrupted" && a.effectState !== "uncertain")
    || (a.cancellationReason !== null && a.status !== "running" && a.status !== "cancelled")
    || (!leased && (a.startedAt !== null || a.stopConfirmedAt !== null || (a.status !== "queued" && a.status !== "cancelled")))
    || (!leased && a.status === "cancelled" && (a.effectState !== "no_effect" || result !== null))
    || (a.startedAt !== null && a.effectState === "no_effect")) return runFail("storage_unavailable");
  for (const time of [a.claimedAt, a.startedAt, a.finishedAt, a.stopConfirmedAt]) {
    if (time !== null && time < a.createdAt) return runFail("storage_unavailable");
  }
  const claimed = a.claimedAt, started = a.startedAt;
  if ((claimed !== null && (a.leaseExpiresAt === null || a.leaseExpiresAt <= claimed
    || [started, a.finishedAt, a.stopConfirmedAt].some(t => t !== null && t < claimed)))
    || (started !== null && [a.finishedAt, a.stopConfirmedAt].some(t => t !== null && t < started))) return runFail("storage_unavailable");
  return { attempt: a, result };
}
export function readRunRows(rawRun: unknown, rawAttempt: unknown) {
  const { run, input } = parseStoredRun(rawRun), { attempt, result } = parseStoredAttempt(rawAttempt, run, input.input.budgets.maxEvents);
  if (attempt.generation !== run.currentGeneration || attempt.status !== run.status || attempt.startedAt !== run.startedAt || attempt.finishedAt !== run.finishedAt) return runFail("storage_unavailable");
  const state = parseRunState({ runId: run.id, attemptId: attempt.id, generation: attempt.generation, revision: run.revision,
    status: attempt.status, effectState: attempt.effectState, maxEvents: input.input.budgets.maxEvents,
    leaseId: attempt.leaseId, leaseExpiresAtMs: attempt.leaseExpiresAt, createdAtMs: attempt.createdAt,
    claimedAtMs: attempt.claimedAt, startedAtMs: attempt.startedAt, finishedAtMs: attempt.finishedAt,
    cancelRequestedAtMs: run.cancelRequestedAt, stopConfirmedAtMs: attempt.stopConfirmedAt, cancellationReason: attempt.cancellationReason, result });
  const dto = parseRunDto({ id: run.id, revision: run.revision, origin: run.originKind, botId: run.botId, conversationId: run.conversationId,
    configurationId: run.configurationId, configurationVersion: run.configurationVersion, status: run.status,
    attemptId: attempt.id, generation: attempt.generation, effectState: attempt.effectState, createdAtMs: run.createdAt,
    startedAtMs: run.startedAt, finishedAtMs: run.finishedAt, cancelRequestedAtMs: run.cancelRequestedAt });
  return Object.freeze({ run, attempt, input, state, dto });
}
export function readRunResult(rawRun: unknown, rawAttempt: unknown) {
  const { run, input } = parseStoredRun(rawRun), { attempt, result } = parseStoredAttempt(rawAttempt, run, input.input.budgets.maxEvents);
  if (attempt.generation === run.currentGeneration) readRunRows(rawRun, rawAttempt);
  if (!isRunTerminal(attempt.status)) throw new RunStoreError("result_pending");
  return parseRunResultDto({ runId: run.id, attemptId: attempt.id, generation: attempt.generation, status: attempt.status,
    effectState: attempt.effectState, finishedAtMs: attempt.finishedAt, result }, input.input.budgets.maxEvents);
}
export function runProjection(value: RunState) {
  const s = parseRunState(value), date = (time: number | null) => time === null ? null : new Date(time);
  return Object.freeze({
    run: Object.freeze({ revision: s.revision, status: s.status, cancelRequestedAt: date(s.cancelRequestedAtMs), startedAt: date(s.startedAtMs), finishedAt: date(s.finishedAtMs) } satisfies Partial<typeof runs.$inferInsert>),
    attempt: Object.freeze({ status: s.status, effectState: s.effectState, leaseId: s.leaseId, leaseExpiresAt: date(s.leaseExpiresAtMs), claimedAt: date(s.claimedAtMs),
      startedAt: date(s.startedAtMs), finishedAt: date(s.finishedAtMs), stopConfirmedAt: date(s.stopConfirmedAtMs), cancellationReason: s.cancellationReason,
      resultVersion: s.result?.version ?? null, resultText: s.result?.text ?? null, resultErrorCode: s.result?.errorCode ?? null, resultLastSequence: s.result?.lastSequence ?? null } satisfies Partial<typeof runAttempts.$inferInsert>),
  });
}

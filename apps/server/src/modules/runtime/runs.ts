import { uuidv7 } from "@zetta/core/uuid";
import { z } from "zod";
import type { Database } from "@zetta/db";
import { and, eq, sql } from "@zetta/db/query";
import { runs, runAttempts } from "@zetta/db/schema/runs";
import { membership } from "@zetta/db/schema/identity";
import { AccessError, requireOwned, type ActiveActor } from "../identity/access";
import {
  canonicalRunInput,
  parseCancelRunRequest,
  parseOwnedRunRequest,
  parseSubmitRequest,
  RunBoundaryError,
  runCounterSchema,
  runEpochSchema,
  runFail,
  runUuidSchema,
} from "./run-contract";
import { readRunRows, readRunResult, runProjection, RunStoreError } from "./run-rows";
import { transitionRun, type RunBackendFact, type RunTransitionToken } from "./run-state";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Stored = Awaited<ReturnType<typeof loadCurrent>>;
const resultRequest = z.strictObject({ runId: runUuidSchema, attemptId: runUuidSchema });
async function loadAttempt(tx: Transaction, row: typeof runs.$inferSelect) {
  const [attempt] = await tx
    .select()
    .from(runAttempts)
    .where(
      and(
        eq(runAttempts.runId, row.id),
        eq(runAttempts.ownerUserId, row.ownerUserId),
        eq(runAttempts.generation, row.currentGeneration),
      ),
    )
    .for("update");
  if (!attempt) return runFail("storage_unavailable");
  return { row, attempt, parsed: readRunRows(row, attempt) };
}
async function loadCurrent(tx: Transaction, owner: string, id: string) {
  const [row] = await tx
    .select()
    .from(runs)
    .where(and(eq(runs.ownerUserId, owner), eq(runs.id, id)))
    .for("update");
  if (!row) throw new RunStoreError("not_found");
  return loadAttempt(tx, row);
}
async function clock(tx: Transaction, owner: string) {
  const [row] = await tx
    .select({ now: sql<string>`floor(extract(epoch from clock_timestamp()) * 1000)::text` })
    .from(membership)
    .where(eq(membership.userId, owner));
  if (typeof row?.now !== "string" || !/^-?\d+$/.test(row.now))
    return runFail("storage_unavailable");
  const parsed = runEpochSchema.safeParse(Number(row.now));
  return parsed.success ? parsed.data : runFail("storage_unavailable");
}
async function persist(
  tx: Transaction,
  stored: Stored,
  token: RunTransitionToken,
  fact: RunBackendFact,
) {
  const { parsed, row, attempt } = stored;
  const next = transitionRun(parsed.state, token, fact);
  if (next.revision === parsed.state.revision) return parsed.dto;
  const patch = runProjection(next);
  const [updatedRun] = await tx
    .update(runs)
    .set(patch.run)
    .where(
      and(
        eq(runs.ownerUserId, row.ownerUserId),
        eq(runs.id, row.id),
        eq(runs.revision, row.revision),
        eq(runs.currentGeneration, attempt.generation),
      ),
    )
    .returning();
  if (!updatedRun) return runFail("stale_revision");
  const [updatedAttempt] = await tx
    .update(runAttempts)
    .set(patch.attempt)
    .where(
      and(
        eq(runAttempts.ownerUserId, row.ownerUserId),
        eq(runAttempts.runId, row.id),
        eq(runAttempts.id, attempt.id),
        eq(runAttempts.generation, attempt.generation),
      ),
    )
    .returning();
  if (!updatedAttempt) return runFail("storage_unavailable");
  return readRunRows(updatedRun, updatedAttempt).dto;
}
/** Trusted transaction primitive, not owner authority. Caller must already hold fresh active membership
 * and any earlier sorted connection locks; caller owns commit/rollback. No backend IO runs here. */
export async function applyRunTransition(
  tx: Transaction,
  ownerUserId: string,
  token: RunTransitionToken,
  fact: RunBackendFact,
) {
  const current = await loadCurrent(tx, ownerUserId, token.runId);
  return persist(tx, current, token, fact);
}
export function createRunStore(db: Pick<Database, "transaction">) {
  async function owned<T>(
    actor: ActiveActor,
    mutation: boolean,
    work: (tx: Transaction, owner: string, activationRevision: number) => Promise<T>,
  ) {
    try {
      if (!actor || typeof actor.userId !== "string") throw new AccessError("NOT_FOUND");
      const owner = requireOwned(actor, { ownerUserId: actor.userId }).ownerUserId;
      return await db.transaction(
        async (tx) => {
          const [member] = await tx
            .select({
              status: membership.status,
              activationRevision: membership.activationRevision,
            })
            .from(membership)
            .where(eq(membership.userId, owner))
            .for("update");
          if (member?.status !== "active") throw new AccessError("ACCESS_DENIED");
          const revision = runCounterSchema.safeParse(member.activationRevision);
          if (!revision.success) return runFail("storage_unavailable");
          return work(tx, owner, revision.data);
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (
        error instanceof AccessError ||
        error instanceof RunBoundaryError ||
        error instanceof RunStoreError
      )
        throw error;
      if (mutation) throw new RunStoreError("outcome_unknown");
      return runFail("storage_unavailable");
    }
  }
  return Object.freeze({
    async submitOwned(actor: ActiveActor, value: unknown) {
      const request = parseSubmitRequest(value),
        inputSnapshot = canonicalRunInput(request);
      return owned(actor, true, async (tx, owner, activationRevision) => {
        const prior = async () => {
          const [row] = await tx
            .select()
            .from(runs)
            .where(and(eq(runs.ownerUserId, owner), eq(runs.requestKey, request.requestKey)))
            .for("update");
          if (!row) return undefined;
          const current = await loadAttempt(tx, row);
          if (row.inputSnapshot !== inputSnapshot) throw new RunStoreError("request_conflict");
          return current.parsed.dto;
        };
        const existing = await prior();
        if (existing) return existing;
        const now = new Date(await clock(tx, owner)),
          id = uuidv7(),
          attemptId = uuidv7();
        const [row] = await tx
          .insert(runs)
          .values({
            id,
            ownerUserId: owner,
            requestKey: request.requestKey,
            originKind: request.origin,
            botId: request.botId,
            conversationId: request.conversationId,
            configurationId: request.configurationId,
            configurationVersion: request.configurationVersion,
            inputVersion: 1,
            inputSnapshot,
            createdAt: now,
            producerKind: "fixture",
            producerVersion: 1,
            actorActivationRevision: activationRevision,
            revision: 1,
            status: "queued",
            currentGeneration: 1,
          })
          .onConflictDoNothing({ target: [runs.ownerUserId, runs.requestKey] })
          .returning();
        if (!row) {
          const replay = await prior();
          if (!replay) return runFail("storage_unavailable");
          return replay;
        }
        const [attempt] = await tx
          .insert(runAttempts)
          .values({
            id: attemptId,
            runId: id,
            ownerUserId: owner,
            generation: 1,
            createdAt: now,
            status: "queued",
            effectState: "no_effect",
          })
          .returning();
        return readRunRows(row, attempt).dto;
      });
    },
    async getOwned(actor: ActiveActor, value: unknown) {
      const request = parseOwnedRunRequest(value);
      return owned(
        actor,
        false,
        async (tx, owner) => (await loadCurrent(tx, owner, request.runId)).parsed.dto,
      );
    },
    async getResultOwned(actor: ActiveActor, value: unknown) {
      const parsed = resultRequest.safeParse(value);
      if (!parsed.success) return runFail("invalid_input");
      const request = parsed.data;
      return owned(actor, false, async (tx, owner) => {
        const current = await loadCurrent(tx, owner, request.runId);
        const [attempt] = await tx
          .select()
          .from(runAttempts)
          .where(
            and(
              eq(runAttempts.ownerUserId, owner),
              eq(runAttempts.runId, request.runId),
              eq(runAttempts.id, request.attemptId),
            ),
          )
          .for("update");
        if (!attempt) throw new RunStoreError("not_found");
        return readRunResult(current.row, attempt);
      });
    },
    async cancelOwned(actor: ActiveActor, value: unknown) {
      const request = parseCancelRunRequest(value);
      return owned(actor, true, async (tx, owner) => {
        const current = await loadCurrent(tx, owner, request.runId),
          state = current.parsed.state;
        const atMs = await clock(tx, owner);
        return persist(
          tx,
          current,
          {
            runId: state.runId,
            attemptId: state.attemptId,
            generation: state.generation,
            leaseId: state.leaseId,
            expectedRevision: request.expectedRevision,
          },
          { type: "cancel", atMs },
        );
      });
    },
  });
}

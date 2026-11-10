import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, or, sql } from "@zetta/db/query";
import { bot, message } from "@zetta/db/schema/chat";
import { memoryItem } from "@zetta/db/schema/memory";
import { attentionItem, delegation, hook, reaction } from "@zetta/db/schema/features";
import { AccessError, type ActiveActor } from "../identity/access";
import type { ComputerService } from "../computer/service";
import { createTurnRunner, evaluateHooks } from "../chat/pipeline";
import type { DecisionService } from "../decisions/service";
import { listActivity } from "./audit";
import {
  applyAttentionAction,
  attentionSummary,
  raiseAttention,
  type AttentionAction,
} from "./attention";
import { visibleTo } from "../memory/service";
import { createKnowledge } from "./knowledge";
import { createRoutines } from "./routines";
import { createRoutineTriggers } from "./routine-triggers";
import { createSnapshots } from "./snapshots";
import { safeRegex } from "./safety";
import { createWorkflows } from "./workflows";
import type { RecoveryScope } from "../runtime/instance";

export class HookError extends Error {
  constructor(readonly code: "INVALID_PATTERN" | "LIMIT") {
    super(code);
  }
}
export const REACTIONS = ["👍", "👎", "❤️", "🎉", "👀", "✅"] as const;

/** True for exactly one emoji grapheme (flags, keycaps, ZWJ sequences and skin tones included), so any emoji can be a reaction but arbitrary text cannot. */
export function isReactionEmoji(value: string): boolean {
  if (value.length === 0 || value.length > 32) return false;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
  return (
    graphemes.length === 1 &&
    /^(\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u.test(value)
  );
}
const first = <T>(rows: T[]): T => {
  if (!rows[0]) throw new AccessError("NOT_FOUND");
  return rows[0];
};

export function createFeaturesService(
  db: Database,
  run = createTurnRunner(db),
  decisions?: DecisionService,
  computer?: ComputerService,
  sources?: Parameters<typeof createWorkflows>[4],
) {
  const knowledge = createKnowledge(db);
  const workflows = createWorkflows(db, run, decisions, computer, sources);
  const routines = createRoutines(db, run, (userId, id, input) =>
    workflows
      .runForOwner(userId, id, input)
      .then((r) => ({ status: r.run.status, output: r.output })),
  );
  const routineTriggers = createRoutineTriggers(db, routines.fireEvent);
  const snapshots = createSnapshots(db);
  const usableBot = async (actor: ActiveActor, botId: string) =>
    first(
      (
        await db
          .select()
          .from(bot)
          .where(and(eq(bot.id, botId), eq(bot.archived, false)))
      ).filter((b) => b.ownerUserId === actor.userId || b.visibility === "team"),
    );
  const ownedBot = async (actor: ActiveActor, botId: string) =>
    first(
      await db
        .select()
        .from(bot)
        .where(and(eq(bot.id, botId), eq(bot.ownerUserId, actor.userId), eq(bot.archived, false))),
    );

  return {
    knowledge,
    workflows,
    routines,
    routineTriggers,
    snapshots,
    // --- what an answer used ---
    /** What a given answer used: the memories and memory items recorded on it (only what the requester may read). */
    async usedKnowledge(a: ActiveActor, messageId: string) {
      const [m] = await db
        .select({ meta: message.meta })
        .from(message)
        .where(and(eq(message.id, messageId), eq(message.ownerUserId, a.userId)));
      const used = (
        (first(m ? [m] : []).meta ?? {}) as {
          used?: { notes: { id: string }[]; instructions: { id: string }[]; items?: string[] };
        }
      ).used ?? { notes: [], instructions: [] };
      // The ids of the notes and profile items that were in the prompt (they were memory rows before they became memory items).
      const mem = used.notes.length
        ? await db
            .select({ id: memoryItem.id, content: memoryItem.content })
            .from(memoryItem)
            .where(
              and(
                inArray(
                  memoryItem.id,
                  used.notes.map((u) => u.id),
                ),
                visibleTo(a.userId),
              ),
            )
        : [];
      // `instructions` holds memory ids (the old instruction ids became memory ids); `memory` holds the slugs listed in the prompt.
      const ids = used.instructions.map((u) => u.id);
      const slugs = used.items ?? [];
      const items =
        ids.length || slugs.length
          ? await db
              .select({ id: memoryItem.id, slug: memoryItem.slug, title: memoryItem.title })
              .from(memoryItem)
              .where(
                and(
                  or(
                    ids.length ? inArray(memoryItem.id, ids) : undefined,
                    slugs.length ? inArray(memoryItem.slug, slugs) : undefined,
                  ),
                  visibleTo(a.userId),
                ),
              )
          : [];
      return {
        notes: mem.map((x) => ({ id: x.id, content: x.content })),
        items: items.map((x) => ({ id: x.id, slug: x.slug, title: x.title })),
      };
    },
    // --- hooks (configuration belongs to the bot owner) ---
    listHooks: async (a: ActiveActor, botId: string) => {
      await ownedBot(a, botId);
      return db
        .select()
        .from(hook)
        .where(and(eq(hook.botId, botId), eq(hook.ownerUserId, a.userId)))
        .orderBy(asc(hook.position), asc(hook.createdAt));
    },
    addHook: async (
      a: ActiveActor,
      botId: string,
      v: { kind: (typeof hook.$inferInsert)["kind"]; pattern?: string; value?: string },
    ) => {
      await ownedBot(a, botId);
      if ((v.kind === "redact" || v.kind === "stop") && !safeRegex(v.pattern ?? ""))
        throw new HookError("INVALID_PATTERN");
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(hook)
        .where(eq(hook.botId, botId));
      if (Number(n) >= 20) throw new HookError("LIMIT");
      return first(
        await db
          .insert(hook)
          .values({
            ownerUserId: a.userId,
            botId,
            kind: v.kind,
            pattern: v.pattern ?? "",
            value: v.value ?? "",
            position: Number(n),
          })
          .returning(),
      );
    },
    updateHook: async (
      a: ActiveActor,
      id: string,
      v: { pattern?: string; value?: string; enabled?: boolean; position?: number },
    ) => {
      const [h] = await db
        .select()
        .from(hook)
        .where(and(eq(hook.id, id), eq(hook.ownerUserId, a.userId)));
      const cur = first(h ? [h] : []);
      if (
        (cur.kind === "redact" || cur.kind === "stop") &&
        v.pattern !== undefined &&
        !safeRegex(v.pattern)
      )
        throw new HookError("INVALID_PATTERN");
      return first(
        await db
          .update(hook)
          .set(v)
          .where(and(eq(hook.id, id), eq(hook.ownerUserId, a.userId)))
          .returning(),
      );
    },
    /** Pure preview: what the bot's hooks would do to this text, without calling any model or saving anything. */
    dryRunHooks: async (a: ActiveActor, botId: string, text: string) => {
      await ownedBot(a, botId);
      const active = await db
        .select()
        .from(hook)
        .where(and(eq(hook.botId, botId), eq(hook.ownerUserId, a.userId)))
        .orderBy(asc(hook.position));
      const r = await evaluateHooks(active, text.slice(0, 20_000), []);
      return {
        text: r.text,
        stopped: r.stop !== undefined,
        stopMessage: r.stop ?? null,
        addedContext: r.context,
        backgroundTasks: r.background.length,
        skippedInvalid: r.problems.length,
      };
    },
    deleteHook: async (a: ActiveActor, id: string) =>
      first(
        await db
          .delete(hook)
          .where(and(eq(hook.id, id), eq(hook.ownerUserId, a.userId)))
          .returning(),
      ),
    // --- attention ---
    listAttention: (a: ActiveActor) =>
      db
        .select()
        .from(attentionItem)
        .where(eq(attentionItem.ownerUserId, a.userId))
        .orderBy(desc(attentionItem.updatedAt))
        .limit(200),
    attentionSummary: (a: ActiveActor) => attentionSummary(db, a.userId),
    addAttention: async (
      a: ActiveActor,
      v: { title: string; detail?: string; nextAction?: string; botId?: string },
    ) => {
      if (v.botId) await usableBot(a, v.botId);
      return raiseAttention(db, a.userId, { ...v, source: "manual" });
    },
    /** Moves the card only; it never changes any run or approves any change. */
    attentionAction: async (a: ActiveActor, id: string, action: AttentionAction) =>
      first(await applyAttentionAction(db, a.userId, id, action).then((r) => (r ? [r] : []))),
    activity: (
      a: ActiveActor,
      opts: {
        limit?: number;
        before?: string;
        kind?: Parameters<typeof listActivity>[2] extends infer O
          ? O extends { kind?: infer K }
            ? K
            : never
          : never;
      },
    ) => listActivity(db, a.userId, opts),
    // --- reactions ---
    async react(a: ActiveActor, messageId: string, emoji: string) {
      if (!isReactionEmoji(emoji)) throw new AccessError("NOT_FOUND");
      const [m] = await db
        .select()
        .from(message)
        .where(and(eq(message.id, messageId), eq(message.ownerUserId, a.userId)));
      first(m ? [m] : []);
      await db
        .insert(reaction)
        .values({ messageId, ownerUserId: a.userId, emoji })
        .onConflictDoNothing();
      return this.reactions(a, messageId);
    },
    async unreact(a: ActiveActor, messageId: string, emoji: string) {
      const [m] = await db
        .select()
        .from(message)
        .where(and(eq(message.id, messageId), eq(message.ownerUserId, a.userId)));
      first(m ? [m] : []);
      await db
        .delete(reaction)
        .where(
          and(
            eq(reaction.messageId, messageId),
            eq(reaction.ownerUserId, a.userId),
            eq(reaction.emoji, emoji),
          ),
        );
      return this.reactions(a, messageId);
    },
    async reactions(a: ActiveActor, messageId: string) {
      const rows = await db
        .select({ emoji: reaction.emoji, n: sql<number>`count(*)` })
        .from(reaction)
        .where(eq(reaction.messageId, messageId))
        .groupBy(reaction.emoji);
      const mine = await db
        .select({ emoji: reaction.emoji })
        .from(reaction)
        .where(and(eq(reaction.messageId, messageId), eq(reaction.ownerUserId, a.userId)));
      return rows.map((r) => ({
        emoji: r.emoji,
        count: Number(r.n),
        mine: mine.some((x) => x.emoji === r.emoji),
      }));
    },
    // --- delegations ---
    delegations: (a: ActiveActor, conversationId: string) =>
      db
        .select()
        .from(delegation)
        .where(
          and(eq(delegation.conversationId, conversationId), eq(delegation.ownerUserId, a.userId)),
        )
        .orderBy(asc(delegation.createdAt)),
    /** Arms the job of every active routine and the overdue sweep. Safe to call again: it disarms what is gone and re-arms the rest. */
    armRoutines: () => routines.start(),
    /**
     * Reconcile what a dead process left running (see runtime/instance.ts for what "dead" means). At boot it also arms the routine jobs;
     * on the periodic run (`boot` false) it re-runs the routines it just found interrupted.
     */
    async recover(scope?: RecoveryScope, boot = true) {
      const interrupted = await routines.recoverInterrupted(scope);
      const workflowsInterrupted = await workflows.recoverInterrupted(scope);
      if (boot) {
        await routines.start();
        // Once per process: a `bun --hot` reload re-runs boot while the runs it would restart are still alive.
        const once = globalThis as { zettaRoutinesRecovered?: boolean };
        if (!once.zettaRoutinesRecovered) {
          once.zettaRoutinesRecovered = true;
          void routines.recoverRecent().catch(() => {});
        }
      } else if (interrupted) void routines.recoverRecent().catch(() => {});
      return { routines: interrupted, workflows: workflowsInterrupted };
    },
    // Scheduler tick passthrough (kept for the in-process scheduler and tests).
    runDue: (now?: Date) => routines.runDue(now),
    /** Re-runs, once each, the routines whose latest run in the window failed or was interrupted. */
    recoverRecent: (now?: Date, windowMs?: number, userId?: string) =>
      routines.recoverRecent(now, windowMs, userId),
    /** Runs the retries of failed routine runs whose wait is over (also called by the 5-minute sweep). */
    retryDue: (now?: Date) => routines.retryDue(now),
  };
}
export type FeaturesService = ReturnType<typeof createFeaturesService>;

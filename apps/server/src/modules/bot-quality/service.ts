import { topics } from "@zetta/core/live-topics";
import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "@zetta/db/query";
import { bot, botRevision, conversation, message } from "@zetta/db/schema/chat";
import {
  auditEvent,
  botDrivePrompt,
  botDriveRun,
  configProposal,
  attentionItem,
  DRIVE_CHOICES,
  DRIVE_PROMPTS_PER_BOT,
  FEEDBACK_REASON_MAX,
  messageFeedback,
  routine,
  routineRun,
} from "@zetta/db/schema/features";
import { task } from "@zetta/db/schema/tasks";
import { z } from "zod";
import type { ActiveActor } from "../identity/access";
import { events } from "../events/bus";
import { TurnBusyError } from "../chat/turns";
import type { ChatService } from "../chat/service";
import type { WithoutItems } from "../chat/pipeline";
import type { SkillReviewService } from "../memory/skill-review";
import type { Learning } from "../learning";

/** A failure with a sentence for the person. `code` picks the HTTP status in routes.ts. */
export class QualityError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT" | "TOO_MANY" | "BUSY",
    readonly safe: string,
  ) {
    super(code);
  }
}

export type QualityDeps = {
  chat: Pick<ChatService, "createConversation" | "startTurn" | "updateBot">;
  /** A thumb down may teach the bot (autolearn); absent in tests that do not need it. */
  skillReview?: Pick<SkillReviewService, "afterDownvote"> | undefined;
  /** A rating, or a pick in a paired test, judges the reply again (modules/learning); absent in tests that do not need it. */
  learning?: Pick<Learning, "outcomes"> | undefined;
};

export const feedbackInput = z.strictObject({
  rating: z.enum(["up", "down"]),
  reason: z.string().trim().max(FEEDBACK_REASON_MAX).default(""),
});
export const driveChoiceInput = z.strictObject({ choice: z.enum(DRIVE_CHOICES) });
export const drivePromptInput = z.strictObject({
  title: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(4000),
});

/** Days the activity chart covers. */
export const ACTIVITY_DAYS = 30;

/** A time zone the runtime knows, or UTC. The name is also bound as a SQL parameter, never spliced into the query. */
export function activityZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** The last `count` calendar days in `tz` as YYYY-MM-DD, oldest first, ending with today there. Pure calendar arithmetic, so a DST change cannot repeat or skip a day. */
export function lastDays(tz: string, count: number, now = new Date()): string[] {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (count - 1 - i))).toISOString().slice(0, 10),
  );
}

/** The settings a past version can bring back. Anything else in a snapshot (or not in an old one) is left as it is now. */
const restorable = z
  .object({
    name: z.string(),
    description: z.string(),
    harness: z.string(),
    model: z.string().nullable(),
    personality: z.string(),
    instructions: z.string(),
    outputStyle: z.string(),
    outputStyleId: z.string().nullable(),
    visibility: z.enum(["private", "team"]),
    fallbackHarness: z.string().nullable(),
    fallbackModel: z.string().nullable(),
    computerMode: z.enum(["off", "browser", "desktop"]),
    autoLearn: z.enum(["off", "suggest", "auto"]),
    codeAccess: z.boolean(),
    commitIdentity: z.string(),
    commitEmail: z.string().nullable(),
    contextBytes: z.number().int().nullable(),
    summaryMode: z.enum(["chief", "bot", "off"]),
    summaryMaxChars: z.number().int().nullable(),
    summaryGapBytes: z.number().int().nullable(),
    chatSearchLimit: z.number().int().nullable(),
    voice: z.string().nullable(),
    voiceLanguage: z.string().nullable(),
  })
  .partial();
export type BotConfigSnapshot = z.infer<typeof restorable>;

/** Pure: which settings differ between two snapshots, in the order a person reads them. */
export function changedFields(before: BotConfigSnapshot | undefined, after: BotConfigSnapshot) {
  if (!before) return [] as string[];
  return (Object.keys(after) as (keyof BotConfigSnapshot)[]).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  ) as string[];
}

const readSnapshot = (raw: unknown): BotConfigSnapshot => {
  const r = restorable.safeParse(raw);
  return r.success ? r.data : {};
};

/** The settings a past version brings back, from what was saved for it. Same read as the History page, for the Chief's tool. */
export const restorePatch = readSnapshot;

/** The restorable settings of a bot as it is now, to show what a restore would change. */
export const snapshotOfBot = (r: typeof bot.$inferSelect): BotConfigSnapshot => ({
  name: r.name,
  description: r.description,
  harness: r.harness,
  model: r.model,
  personality: r.personality,
  instructions: r.instructions,
  outputStyle: r.outputStyle,
  outputStyleId: r.outputStyleId,
  visibility: r.visibility,
  fallbackHarness: r.fallbackHarness,
  fallbackModel: r.fallbackModel,
  computerMode: r.computerMode,
  autoLearn: r.autoLearn,
  codeAccess: r.codeAccess,
  commitIdentity: r.commitIdentity,
  commitEmail: r.commitEmail,
  contextBytes: r.contextBytes,
  summaryMode: r.summaryMode,
  summaryMaxChars: r.summaryMaxChars,
  summaryGapBytes: r.summaryGapBytes,
  chatSearchLimit: r.chatSearchLimit,
  voice: r.voice,
  voiceLanguage: r.voiceLanguage,
});

const ANSWER_CHARS = 4000;
const REASON_BY_ERROR = (e: unknown) =>
  e instanceof TurnBusyError
    ? "The bot was busy answering something else."
    : "The bot could not answer. Check its engine in Studio.";

export function createBotQuality(db: Database, deps: QualityDeps) {
  const touch = (userId: string, botId: string, conversationId?: string | null) =>
    events.publish(
      [userId],
      topics.botQuality(botId),
      ...(conversationId ? [topics.conversation(conversationId)] : []),
    );

  /** A bot of this person. Anyone else's bot is not found: these tools are the owner's. */
  async function ownBot(actor: ActiveActor, botId: string) {
    const [b] = await db
      .select({
        id: bot.id,
        name: bot.name,
        version: bot.version,
        harness: bot.harness,
        archived: bot.archived,
      })
      .from(bot)
      .where(and(eq(bot.id, botId), eq(bot.ownerUserId, actor.userId)));
    if (!b) throw new QualityError("NOT_FOUND", "No such bot.");
    return b;
  }

  type DriveRow = {
    id: string;
    status: "running" | "done" | "failed";
    error: string;
    createdAt: Date;
    answer: string | null;
    conversationId: string | null;
    variant: "with" | "without";
    pairId: string | null;
    chosen: "with" | "without" | "same" | null;
  };
  /** The newest pair among the runs of one test, with each side's answer (cut to the length the page shows). */
  function pairOf(rows: readonly DriveRow[]) {
    const newest = rows.find((r) => r.pairId);
    if (!newest) return null;
    const side = (variant: "with" | "without") => {
      const r = rows.find((x) => x.pairId === newest.pairId && x.variant === variant);
      return r
        ? {
            id: r.id,
            status: r.status,
            error: r.error,
            answer: r.answer ? r.answer.slice(0, ANSWER_CHARS) : null,
            conversationId: r.conversationId,
          }
        : null;
    };
    return {
      pairId: newest.pairId!,
      createdAt: newest.createdAt,
      chosen: newest.chosen,
      with: side("with"),
      without: side("without"),
    };
  }

  /** Runs one saved test in its own chat and records the answer. Never throws: a failed run is a row. */
  async function execute(
    actor: ActiveActor,
    runId: string,
    botId: string,
    prompt: string,
    without?: WithoutItems,
  ) {
    let conversationId: string | undefined;
    try {
      const conv = await deps.chat.createConversation(actor, botId);
      conversationId = conv!.id;
      await db.update(botDriveRun).set({ conversationId }).where(eq(botDriveRun.id, runId));
      await db
        .update(conversation)
        .set({ title: "Saved test", titleSource: "manual" })
        .where(eq(conversation.id, conversationId));
      // `history: "previous_turn"` marks the turn as started by the server: no autolearn, and a fresh chat has no earlier turn to read.
      const { follow } = await deps.chat.startTurn(actor, conversationId, {
        content: prompt,
        history: "previous_turn",
        ...(without ? { withoutItems: without } : {}),
      });
      let saved: { id: string; status: string } | undefined;
      for await (const { event } of follow()) if (event.type === "message") saved = event.message;
      const ok = saved?.status === "complete";
      await db
        .update(botDriveRun)
        .set({
          status: ok ? "done" : "failed",
          messageId: ok ? saved!.id : null,
          error: ok ? "" : "The bot did not finish an answer.",
          finishedAt: new Date(),
        })
        .where(eq(botDriveRun.id, runId));
    } catch (e) {
      await db
        .update(botDriveRun)
        .set({ status: "failed", error: REASON_BY_ERROR(e), finishedAt: new Date() })
        .where(eq(botDriveRun.id, runId))
        .catch(() => undefined);
    } finally {
      touch(actor.userId, botId, conversationId);
    }
  }

  return {
    // ---- ratings -------------------------------------------------------------------------------------------------------------

    /** Rates one of the person's bot replies. One rating per reply; a new one replaces the old. A thumb down may teach the bot. */
    async rate(actor: ActiveActor, messageId: string, input: z.infer<typeof feedbackInput>) {
      const v = feedbackInput.parse(input);
      const [m] = await db
        .select({
          id: message.id,
          conversationId: message.conversationId,
          botId: message.botId,
          botVersion: message.botVersion,
          status: message.status,
          role: message.role,
        })
        .from(message)
        .where(and(eq(message.id, messageId), eq(message.ownerUserId, actor.userId)));
      if (!m || m.role !== "assistant" || !m.botId || m.status !== "complete")
        throw new QualityError("NOT_FOUND", "Only an answer of a bot can be rated.");
      const reason = v.rating === "down" ? v.reason : "";
      await db
        .insert(messageFeedback)
        .values({
          messageId,
          ownerUserId: actor.userId,
          botId: m.botId,
          botVersion: m.botVersion,
          rating: v.rating,
          reason,
        })
        .onConflictDoUpdate({
          target: [messageFeedback.messageId, messageFeedback.ownerUserId],
          set: {
            rating: v.rating,
            reason,
            botId: m.botId,
            botVersion: m.botVersion,
            updatedAt: new Date(),
          },
        });
      if (v.rating === "down")
        void deps.skillReview
          ?.afterDownvote({ ownerUserId: actor.userId, replyId: messageId, note: reason })
          .catch(() => undefined);
      // A rating, even a late one, judges the reply again: what its items did is read from this (modules/learning).
      void deps.learning?.outcomes.resolve(messageId, { force: true }).catch(() => undefined);
      touch(actor.userId, m.botId, m.conversationId);
      return { messageId, rating: v.rating, reason };
    },

    async clearRating(actor: ActiveActor, messageId: string) {
      const [row] = await db
        .delete(messageFeedback)
        .where(
          and(
            eq(messageFeedback.messageId, messageId),
            eq(messageFeedback.ownerUserId, actor.userId),
          ),
        )
        .returning({ botId: messageFeedback.botId });
      if (row?.botId) touch(actor.userId, row.botId);
      if (row)
        void deps.learning?.outcomes.resolve(messageId, { force: true }).catch(() => undefined);
      return { cleared: Boolean(row) };
    },

    /** The ratings of one chat, by message id, for the thumbs on its replies. */
    async ratingsOf(actor: ActiveActor, conversationId: string) {
      const rows = await db
        .select({
          id: messageFeedback.messageId,
          rating: messageFeedback.rating,
          reason: messageFeedback.reason,
        })
        .from(messageFeedback)
        .innerJoin(message, eq(message.id, messageFeedback.messageId))
        .where(
          and(
            eq(message.conversationId, conversationId),
            eq(messageFeedback.ownerUserId, actor.userId),
          ),
        );
      return Object.fromEntries(rows.map((r) => [r.id, { rating: r.rating, reason: r.reason }]));
    },

    // ---- numbers -------------------------------------------------------------------------------------------------------------

    /** What a bot did in the last 7 or 30 days, and how often the person had to step in. */
    async stats(actor: ActiveActor, botId: string, days: 7 | 30) {
      const b = await ownBot(actor, botId);
      const since = new Date(Date.now() - days * 86_400_000);
      const runWhere = and(
        eq(auditEvent.ownerUserId, actor.userId),
        eq(auditEvent.botId, botId),
        eq(auditEvent.kind, "harness_run"),
        gte(auditEvent.createdAt, since),
      );
      const [byOutcome, dur, cancelled, steered, cards, asked, rated] = await Promise.all([
        db
          .select({ outcome: auditEvent.outcome, n: sql<number>`count(*)::int` })
          .from(auditEvent)
          .where(runWhere)
          .groupBy(auditEvent.outcome),
        db
          .select({
            median: sql<
              number | null
            >`percentile_cont(0.5) within group (order by ${auditEvent.durationMs})`,
            p90: sql<
              number | null
            >`percentile_cont(0.9) within group (order by ${auditEvent.durationMs})`,
            samples: sql<number>`count(${auditEvent.durationMs})::int`,
          })
          .from(auditEvent)
          .where(runWhere),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(message)
          .where(
            and(
              eq(message.ownerUserId, actor.userId),
              eq(message.botId, botId),
              eq(message.role, "assistant"),
              eq(message.status, "cancelled"),
              gte(message.createdAt, since),
            ),
          ),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(message)
          .innerJoin(conversation, eq(conversation.id, message.conversationId))
          .where(
            and(
              eq(message.ownerUserId, actor.userId),
              eq(conversation.botId, botId),
              eq(message.role, "user"),
              sql`${message.meta} ? 'steer'`,
              gte(message.createdAt, since),
            ),
          ),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(configProposal)
          .where(
            and(
              eq(configProposal.ownerUserId, actor.userId),
              eq(configProposal.proposedByBotId, botId),
              gte(configProposal.createdAt, since),
            ),
          ),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(attentionItem)
          .where(
            and(
              eq(attentionItem.ownerUserId, actor.userId),
              eq(attentionItem.botId, botId),
              inArray(attentionItem.kind, ["bot_ask", "permission_request"]),
              gte(attentionItem.createdAt, since),
            ),
          ),
        db
          .select({ rating: messageFeedback.rating, n: sql<number>`count(*)::int` })
          .from(messageFeedback)
          .where(
            and(
              eq(messageFeedback.ownerUserId, actor.userId),
              eq(messageFeedback.botId, botId),
              gte(messageFeedback.updatedAt, since),
            ),
          )
          .groupBy(messageFeedback.rating),
      ]);
      const count = (o: string) => byOutcome.find((r) => r.outcome === o)?.n ?? 0;
      const total = byOutcome.reduce((a, r) => a + r.n, 0);
      const ok = count("ok");
      const round = (n: number | null | undefined) => (n == null ? null : Math.round(Number(n)));
      return {
        bot: { id: b.id, name: b.name, version: b.version },
        days,
        runs: { total, ok, cancelled: count("cancelled"), failed: total - ok - count("cancelled") },
        duration: {
          medianMs: round(dur[0]?.median),
          p90Ms: round(dur[0]?.p90),
          samples: dur[0]?.samples ?? 0,
        },
        stepIn: {
          cancelledReplies: cancelled[0]?.n ?? 0,
          steered: steered[0]?.n ?? 0,
          approvalCards: cards[0]?.n ?? 0,
          askedYou: asked[0]?.n ?? 0,
        },
        feedback: {
          up: rated.find((r) => r.rating === "up")?.n ?? 0,
          down: rated.find((r) => r.rating === "down")?.n ?? 0,
        },
      };
    },

    /** How much a bot works: routines, calls, messages and tasks, with a per-day series of the last 30 days for the chart. */
    async activity(actor: ActiveActor, botId: string, tzName?: string) {
      const b = await ownBot(actor, botId);
      const tz = activityZone(tzName);
      const days = lastDays(tz, ACTIVITY_DAYS);
      // Midnight of the first day in `tz`, so the totals and the series cover the same days.
      const since = sql`(${days[0]}::date)::timestamp at time zone ${tz}`;
      const dayOf = (col: unknown) => sql<string>`to_char(${col} at time zone ${tz}, 'YYYY-MM-DD')`;
      const runs = and(
        eq(auditEvent.ownerUserId, actor.userId),
        eq(auditEvent.botId, botId),
        eq(auditEvent.kind, "harness_run"),
      );
      const sent = and(
        eq(message.ownerUserId, actor.userId),
        eq(message.botId, botId),
        eq(message.role, "assistant"),
        gte(message.createdAt, since),
      );
      const routineRuns = and(
        eq(routine.botId, botId),
        eq(routineRun.ownerUserId, actor.userId),
        gte(routineRun.startedAt, since),
      );
      const [
        routines,
        routineRunTotals,
        callsAll,
        calls30,
        toolCalls,
        tokens,
        received,
        taskRows,
        callDays,
        sentDays,
        routineDays,
      ] = await Promise.all([
        db
          .select({ paused: routine.paused, n: sql<number>`count(*)::int` })
          .from(routine)
          .where(
            and(
              eq(routine.ownerUserId, actor.userId),
              eq(routine.botId, botId),
              eq(routine.archived, false),
            ),
          )
          .groupBy(routine.paused),
        db
          .select({ status: routineRun.status, n: sql<number>`count(*)::int` })
          .from(routineRun)
          .innerJoin(routine, eq(routine.id, routineRun.routineId))
          .where(routineRuns)
          .groupBy(routineRun.status),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(auditEvent)
          .where(runs),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(auditEvent)
          .where(and(runs, gte(auditEvent.createdAt, since))),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(auditEvent)
          .where(
            and(
              eq(auditEvent.ownerUserId, actor.userId),
              eq(auditEvent.botId, botId),
              eq(auditEvent.kind, "tool_call"),
              gte(auditEvent.createdAt, since),
            ),
          ),
        db
          .select({
            input: sql<number>`coalesce(sum(${auditEvent.inputTokens}), 0)::float8`,
            cacheRead: sql<number>`coalesce(sum(${auditEvent.cacheReadTokens}), 0)::float8`,
            cacheWrite: sql<number>`coalesce(sum(${auditEvent.cacheWriteTokens}), 0)::float8`,
            output: sql<number>`coalesce(sum(${auditEvent.outputTokens}), 0)::float8`,
            // Only some engines report tokens (Claude Code does); the others leave them null, so say how many calls did.
            reported: sql<number>`count(${auditEvent.outputTokens})::int`,
          })
          .from(auditEvent)
          .where(and(runs, gte(auditEvent.createdAt, since))),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(message)
          .innerJoin(conversation, eq(conversation.id, message.conversationId))
          .where(
            and(
              eq(message.ownerUserId, actor.userId),
              eq(conversation.botId, botId),
              eq(message.role, "user"),
              gte(message.createdAt, since),
            ),
          ),
        db
          .select({ status: task.status, n: sql<number>`count(*)::int` })
          .from(task)
          .where(
            and(
              eq(task.ownerUserId, actor.userId),
              eq(task.botId, botId),
              isNull(task.parentTaskId),
            ),
          )
          .groupBy(task.status),
        db
          .select({ day: dayOf(auditEvent.createdAt), n: sql<number>`count(*)::int` })
          .from(auditEvent)
          .where(and(runs, gte(auditEvent.createdAt, since)))
          .groupBy(sql`1`),
        db
          .select({ day: dayOf(message.createdAt), n: sql<number>`count(*)::int` })
          .from(message)
          .where(sent)
          .groupBy(sql`1`),
        db
          .select({ day: dayOf(routineRun.startedAt), n: sql<number>`count(*)::int` })
          .from(routineRun)
          .innerJoin(routine, eq(routine.id, routineRun.routineId))
          .where(routineRuns)
          .groupBy(sql`1`),
      ]);
      const series = (rows: { day: string; n: number }[]) => {
        const by = new Map(rows.map((r) => [r.day, r.n]));
        return days.map((d) => by.get(d) ?? 0);
      };
      const taskN = (s: string) => taskRows.find((r) => r.status === s)?.n ?? 0;
      const tasksTotal = taskRows.reduce((a, r) => a + r.n, 0);
      const sentSeries = series(sentDays);
      return {
        bot: { id: b.id, name: b.name },
        timezone: tz,
        days,
        routines: {
          active: routines.find((r) => !r.paused)?.n ?? 0,
          paused: routines.find((r) => r.paused)?.n ?? 0,
          runs: routineRunTotals.reduce((a, r) => a + r.n, 0),
          failed: routineRunTotals.find((r) => r.status === "failed")?.n ?? 0,
        },
        calls: {
          last30: calls30[0]?.n ?? 0,
          allTime: callsAll[0]?.n ?? 0,
          toolCalls: toolCalls[0]?.n ?? 0,
        },
        // Last 30 days, over the calls whose engine reported tokens (`reportedCalls` of `calls.last30`). `input` is the part that
        // was not served from the cache; `total` adds all four.
        tokens: {
          input: Math.round(tokens[0]?.input ?? 0),
          cacheRead: Math.round(tokens[0]?.cacheRead ?? 0),
          cacheWrite: Math.round(tokens[0]?.cacheWrite ?? 0),
          output: Math.round(tokens[0]?.output ?? 0),
          total: Math.round(
            (tokens[0]?.input ?? 0) +
              (tokens[0]?.cacheRead ?? 0) +
              (tokens[0]?.cacheWrite ?? 0) +
              (tokens[0]?.output ?? 0),
          ),
          reportedCalls: tokens[0]?.reported ?? 0,
        },
        messages: {
          sent: sentSeries.reduce((a, n) => a + n, 0),
          received: received[0]?.n ?? 0,
        },
        tasks: {
          open: tasksTotal - taskN("done"),
          blocked: taskN("blocked"),
          done: taskN("done"),
          total: tasksTotal,
        },
        series: { calls: series(callDays), messages: sentSeries, routineRuns: series(routineDays) },
      };
    },

    // ---- saved tests ---------------------------------------------------------------------------------------------------------

    /** The saved tests of a bot, each with its last three runs and the answers they gave. */
    async drive(actor: ActiveActor, botId: string) {
      const b = await ownBot(actor, botId);
      const prompts = await db
        .select()
        .from(botDrivePrompt)
        .where(and(eq(botDrivePrompt.botId, botId), eq(botDrivePrompt.ownerUserId, actor.userId)))
        .orderBy(asc(botDrivePrompt.position), asc(botDrivePrompt.createdAt));
      const runs = prompts.length
        ? await db
            .select({
              id: botDriveRun.id,
              promptId: botDriveRun.promptId,
              botVersion: botDriveRun.botVersion,
              status: botDriveRun.status,
              error: botDriveRun.error,
              createdAt: botDriveRun.createdAt,
              finishedAt: botDriveRun.finishedAt,
              answer: message.content,
              conversationId: botDriveRun.conversationId,
              variant: botDriveRun.variant,
              pairId: botDriveRun.pairId,
              chosen: botDriveRun.chosen,
            })
            .from(botDriveRun)
            .leftJoin(message, eq(message.id, botDriveRun.messageId))
            .where(
              and(
                inArray(
                  botDriveRun.promptId,
                  prompts.map((p) => p.id),
                ),
                eq(botDriveRun.ownerUserId, actor.userId),
              ),
            )
            .orderBy(desc(botDriveRun.createdAt))
        : [];
      return {
        bot: { id: b.id, name: b.name, version: b.version },
        limit: DRIVE_PROMPTS_PER_BOT,
        prompts: prompts.map((p) => ({
          id: p.id,
          title: p.title,
          prompt: p.prompt,
          runs: runs
            .filter((r) => r.promptId === p.id && !r.pairId)
            .slice(0, 3)
            .map((r) => ({ ...r, answer: r.answer ? r.answer.slice(0, ANSWER_CHARS) : null })),
          // The latest pair of this test: the same question with and without what the bot knows, and which the person preferred.
          pair: pairOf(runs.filter((r) => r.promptId === p.id)),
        })),
      };
    },

    async addPrompt(actor: ActiveActor, botId: string, input: z.infer<typeof drivePromptInput>) {
      const v = drivePromptInput.parse(input);
      await ownBot(actor, botId);
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(botDrivePrompt)
        .where(and(eq(botDrivePrompt.botId, botId), eq(botDrivePrompt.ownerUserId, actor.userId)));
      if (n >= DRIVE_PROMPTS_PER_BOT)
        throw new QualityError(
          "TOO_MANY",
          `A bot keeps ${DRIVE_PROMPTS_PER_BOT} saved tests at most.`,
        );
      const [row] = await db
        .insert(botDrivePrompt)
        .values({ botId, ownerUserId: actor.userId, title: v.title, prompt: v.prompt, position: n })
        .returning();
      touch(actor.userId, botId);
      return row!;
    },

    async updatePrompt(
      actor: ActiveActor,
      botId: string,
      promptId: string,
      input: z.infer<typeof drivePromptInput>,
    ) {
      const v = drivePromptInput.parse(input);
      await ownBot(actor, botId);
      const [row] = await db
        .update(botDrivePrompt)
        .set({ title: v.title, prompt: v.prompt, updatedAt: new Date() })
        .where(
          and(
            eq(botDrivePrompt.id, promptId),
            eq(botDrivePrompt.botId, botId),
            eq(botDrivePrompt.ownerUserId, actor.userId),
          ),
        )
        .returning();
      if (!row) throw new QualityError("NOT_FOUND", "No such saved test.");
      touch(actor.userId, botId);
      return row;
    },

    async removePrompt(actor: ActiveActor, botId: string, promptId: string) {
      await ownBot(actor, botId);
      const [row] = await db
        .delete(botDrivePrompt)
        .where(
          and(
            eq(botDrivePrompt.id, promptId),
            eq(botDrivePrompt.botId, botId),
            eq(botDrivePrompt.ownerUserId, actor.userId),
          ),
        )
        .returning({ id: botDrivePrompt.id });
      if (!row) throw new QualityError("NOT_FOUND", "No such saved test.");
      touch(actor.userId, botId);
      return { removed: true };
    },

    /**
     * Runs one saved test, or all of them, on the bot as it is now. Answers at once with the runs that were started; the tests run one
     * after the other in the background (each in its own hidden chat) and the page follows them through the bot-quality topic.
     */
    async run(actor: ActiveActor, botId: string, promptId?: string) {
      const b = await ownBot(actor, botId);
      if (b.archived) throw new QualityError("NOT_FOUND", "No such bot.");
      if (b.harness === "fixture" || b.harness === "decision")
        throw new QualityError(
          "INVALID",
          "This bot has no engine that writes answers, so there is nothing to compare.",
        );
      const prompts = await db
        .select()
        .from(botDrivePrompt)
        .where(
          and(
            eq(botDrivePrompt.botId, botId),
            eq(botDrivePrompt.ownerUserId, actor.userId),
            promptId ? eq(botDrivePrompt.id, promptId) : undefined,
          ),
        )
        .orderBy(asc(botDrivePrompt.position), asc(botDrivePrompt.createdAt));
      if (!prompts.length) throw new QualityError("NOT_FOUND", "There is no saved test to run.");
      const [running] = await db
        .select({ id: botDriveRun.id })
        .from(botDriveRun)
        .where(
          and(
            eq(botDriveRun.botId, botId),
            eq(botDriveRun.ownerUserId, actor.userId),
            eq(botDriveRun.status, "running"),
            gte(botDriveRun.createdAt, new Date(Date.now() - 15 * 60_000)),
          ),
        )
        .limit(1);
      if (running)
        throw new QualityError("BUSY", "The saved tests of this bot are already running.");
      const rows = await db
        .insert(botDriveRun)
        .values(
          prompts.map((p) => ({
            promptId: p.id,
            botId,
            ownerUserId: actor.userId,
            botVersion: b.version,
          })),
        )
        .returning({ id: botDriveRun.id, promptId: botDriveRun.promptId });
      touch(actor.userId, botId);
      void (async () => {
        for (const r of rows) {
          const p = prompts.find((x) => x.id === r.promptId)!;
          await execute(actor, r.id, botId, p.prompt);
        }
      })();
      return { started: rows.length, botVersion: b.version };
    },

    /**
     * Asks one saved test twice, one after the other: as the bot is, and without its memory and its own skills. The two answers sit side
     * by side for the person to pick from (`choose`). Zetta's built-in skills stay on both sides, so only what the bot learned is left out.
     */
    async compare(actor: ActiveActor, botId: string, promptId: string) {
      const b = await ownBot(actor, botId);
      if (b.archived) throw new QualityError("NOT_FOUND", "No such bot.");
      if (b.harness === "fixture" || b.harness === "decision")
        throw new QualityError(
          "INVALID",
          "This bot has no engine that writes answers, so there is nothing to compare.",
        );
      const [p] = await db
        .select()
        .from(botDrivePrompt)
        .where(
          and(
            eq(botDrivePrompt.id, promptId),
            eq(botDrivePrompt.botId, botId),
            eq(botDrivePrompt.ownerUserId, actor.userId),
          ),
        );
      if (!p) throw new QualityError("NOT_FOUND", "No such saved test.");
      const [running] = await db
        .select({ id: botDriveRun.id })
        .from(botDriveRun)
        .where(
          and(
            eq(botDriveRun.botId, botId),
            eq(botDriveRun.ownerUserId, actor.userId),
            eq(botDriveRun.status, "running"),
            gte(botDriveRun.createdAt, new Date(Date.now() - 15 * 60_000)),
          ),
        )
        .limit(1);
      if (running)
        throw new QualityError("BUSY", "The saved tests of this bot are already running.");
      const pairId = uuidv7();
      const rows = await db
        .insert(botDriveRun)
        .values(
          (["with", "without"] as const).map((variant) => ({
            promptId: p.id,
            botId,
            ownerUserId: actor.userId,
            botVersion: b.version,
            variant,
            pairId,
          })),
        )
        .returning({ id: botDriveRun.id, variant: botDriveRun.variant });
      touch(actor.userId, botId);
      void (async () => {
        // One after the other: two engine runs at once would only slow both down, and the second must not see the first's chat.
        for (const r of rows)
          await execute(
            actor,
            r.id,
            botId,
            p.prompt,
            r.variant === "without" ? { memory: true, skills: true } : undefined,
          );
      })();
      return { started: rows.length, pairId, botVersion: b.version };
    },

    /**
     * The person's pick between the two answers of a pair. "with" and "without" are the person's own word on the reply that had the bot's
     * memory and skills, and count for or against what it used (the strongest signal there is); "same" changes nothing.
     */
    async choose(
      actor: ActiveActor,
      botId: string,
      pairId: string,
      input: z.infer<typeof driveChoiceInput>,
    ) {
      const { choice } = driveChoiceInput.parse(input);
      await ownBot(actor, botId);
      const runs = await db
        .select({
          id: botDriveRun.id,
          variant: botDriveRun.variant,
          status: botDriveRun.status,
          messageId: botDriveRun.messageId,
        })
        .from(botDriveRun)
        .where(
          and(
            eq(botDriveRun.pairId, pairId),
            eq(botDriveRun.botId, botId),
            eq(botDriveRun.ownerUserId, actor.userId),
          ),
        );
      const withRun = runs.find((r) => r.variant === "with");
      if (!withRun || runs.length !== 2) throw new QualityError("NOT_FOUND", "No such comparison.");
      if (runs.some((r) => r.status !== "done" || !r.messageId))
        throw new QualityError("INVALID", "Wait until both answers are finished.");
      await db
        .update(botDriveRun)
        .set({ chosen: choice })
        .where(and(eq(botDriveRun.pairId, pairId), eq(botDriveRun.ownerUserId, actor.userId)));
      if (choice !== "same")
        await deps.learning?.outcomes.adopt(withRun.messageId!).catch(() => undefined);
      touch(actor.userId, botId);
      return { pairId, chosen: choice };
    },

    // ---- version history -----------------------------------------------------------------------------------------------------

    /** The saved versions of a bot, newest first, each with the settings that changed from the version before it. */
    async revisions(actor: ActiveActor, botId: string) {
      const b = await ownBot(actor, botId);
      const rows = await db
        .select({
          version: botRevision.version,
          config: botRevision.config,
          createdAt: botRevision.createdAt,
        })
        .from(botRevision)
        .where(eq(botRevision.botId, botId))
        .orderBy(desc(botRevision.version))
        .limit(51);
      const snaps = rows.map((r) => readSnapshot(r.config));
      return {
        bot: { id: b.id, name: b.name, version: b.version },
        revisions: rows.slice(0, 50).map((r, i) => ({
          version: r.version,
          createdAt: r.createdAt,
          current: r.version === b.version,
          changed: changedFields(snaps[i + 1], snaps[i]!),
          config: snaps[i]!,
        })),
      };
    },

    /** Brings a past version back as a NEW version (history is never rewound). Only the settings that version holds are restored. */
    async restore(actor: ActiveActor, botId: string, version: number, expectedVersion: number) {
      const b = await ownBot(actor, botId);
      if (version === b.version)
        throw new QualityError("INVALID", "That is the version the bot has now.");
      const [rev] = await db
        .select({ config: botRevision.config })
        .from(botRevision)
        .where(and(eq(botRevision.botId, botId), eq(botRevision.version, version)));
      if (!rev) throw new QualityError("NOT_FOUND", "That version is not kept.");
      const snap = readSnapshot(rev.config);
      if (!snap.name) throw new QualityError("INVALID", "That version cannot be restored.");
      const row = await deps.chat.updateBot(actor, botId, expectedVersion, snap as never);
      touch(actor.userId, botId);
      return { version: row.version };
    },
  };
}
export type BotQuality = ReturnType<typeof createBotQuality>;

import {
  ITEM_USE_KEEP_DAYS,
  OUTCOME_SETTLE_MS,
  SIGNAL_WEIGHTS,
  type ReplySignal,
} from "@zetta/core/learning";
import type { Database } from "@zetta/db";
import { and, asc, eq, gt, isNull, lt, or, sql } from "@zetta/db/query";
import { message } from "@zetta/db/schema/chat";
import { botDriveRun, messageFeedback } from "@zetta/db/schema/features";
import { itemUse, replyOutcome } from "@zetta/db/schema/learning";
import { task } from "@zetta/db/schema/tasks";
import { looksLikeCorrection } from "./corrections";

/**
 * Did the person have to step in after this reply? Judged once, from what happened to it. A pure function of stored signals: running it
 * again, in any order, gives the same verdict, so the ticker, a late rating and a restart cannot disagree.
 */

/** Wait this long after a reply is recorded before the ticker judges it: the "Send now" marker is written just after the reply. */
const GRACE_MS = 2 * 60_000;
const PER_TICK = 500;
const PRUNE_EVERY_MS = 3_600_000;

export type Verdict = {
  outcome: "good" | "neutral" | "bad";
  weight: number;
  signals: ReplySignal[];
};

/**
 * The verdict for a set of signals. Zetta restarting while the reply ran, and the person pressing "Send now", are never a complaint:
 * the reply is neutral whatever else is on record. Otherwise the signals' weights add up: positive is good, negative is bad.
 */
export function resolveOutcome(signals: readonly ReplySignal[]): Verdict {
  const set = [...new Set(signals)];
  for (const quiet of ["interrupted", "send_now"] as const)
    if (set.includes(quiet)) return { outcome: "neutral", weight: 0, signals: [quiet] };
  const weight = set.reduce((n, s) => n + SIGNAL_WEIGHTS[s], 0);
  return { outcome: weight > 0 ? "good" : weight < 0 ? "bad" : "neutral", weight, signals: set };
}

type Gathered = { signals: ReplySignal[]; settled: boolean };

export function createOutcomes(db: Database) {
  let busy = false,
    lastPrune = 0;

  /**
   * What happened to one reply, read from the database. `settled` says the story is over: the reply was stopped or cut off, the person
   * wrote again, or a day passed. A reply Zetta started itself (a routine, a loop) is only judged by a rating or a stop: nobody read
   * it and wrote back.
   */
  async function gather(
    messageId: string,
    origin: "person" | "server",
  ): Promise<Gathered | undefined> {
    const [reply] = await db
      .select({
        id: message.id,
        role: message.role,
        conversationId: message.conversationId,
        ownerUserId: message.ownerUserId,
        seq: message.seq,
        status: message.status,
        meta: message.meta,
        createdAt: message.createdAt,
      })
      .from(message)
      .where(eq(message.id, messageId));
    if (!reply || reply.role !== "assistant") return undefined;
    const signals: ReplySignal[] = [];
    const meta = (reply.meta ?? {}) as { ended?: unknown };
    if (reply.status === "cancelled")
      signals.push(meta.ended === "send_now" ? "send_now" : "stopped");
    if (reply.status === "interrupted") signals.push("interrupted");
    const rated = await db
      .select({ rating: messageFeedback.rating })
      .from(messageFeedback)
      .where(
        and(
          eq(messageFeedback.messageId, reply.id),
          eq(messageFeedback.ownerUserId, reply.ownerUserId),
        ),
      );
    for (const r of rated) signals.push(r.rating === "up" ? "thumbs_up" : "thumbs_down");
    const [done] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.messageId, reply.id), eq(task.status, "done")))
      .limit(1);
    if (done) signals.push("task_done");
    // A paired test: the person picked between the answer with what the bot knows and the one without. Only the "with" reply is judged.
    const [pair] = await db
      .select({ chosen: botDriveRun.chosen })
      .from(botDriveRun)
      .where(and(eq(botDriveRun.messageId, reply.id), eq(botDriveRun.variant, "with")))
      .limit(1);
    const picked = pair?.chosen === "with" || pair?.chosen === "without";
    if (pair?.chosen === "with") signals.push("chose_better");
    if (pair?.chosen === "without") signals.push("chose_worse");
    let next = false;
    if (origin === "person") {
      // What the person sent while this reply was written. Adding to a request is how people chat and says nothing against the
      // reply; only a message that reads as a correction counts as stepping in.
      const added = await db
        .select({ content: message.content })
        .from(message)
        .where(
          and(
            eq(message.conversationId, reply.conversationId),
            eq(message.role, "user"),
            sql`${message.meta}->'steer'->>'replyId' = ${reply.id}`,
          ),
        )
        .limit(20);
      if (added.some((m) => looksLikeCorrection(m.content))) signals.push("steered");
      // The person's next message that is not a note they slipped in while the reply ran.
      const [following] = await db
        .select({ content: message.content })
        .from(message)
        .where(
          and(
            eq(message.conversationId, reply.conversationId),
            eq(message.role, "user"),
            gt(message.seq, reply.seq),
            isNull(message.parentMessageId),
            sql`not (coalesce(${message.meta}, '{}'::jsonb) ? 'steer')`,
          ),
        )
        .orderBy(asc(message.seq))
        .limit(1);
      if (following) {
        next = true;
        signals.push(looksLikeCorrection(following.content) ? "corrected" : "carried_on");
      }
    }
    const terminal = reply.status !== "complete";
    const old = Date.now() - reply.createdAt.getTime() >= OUTCOME_SETTLE_MS;
    return { signals, settled: terminal || next || old || picked || origin === "server" };
  }

  async function resolve(messageId: string, opts: { force?: boolean } = {}) {
    const [row] = await db
      .select({ origin: replyOutcome.origin })
      .from(replyOutcome)
      .where(eq(replyOutcome.messageId, messageId));
    if (!row) return undefined; // no item was in front of this reply: nothing to judge
    const g = await gather(messageId, row.origin);
    if (!g || (!g.settled && !opts.force)) return undefined;
    const v = resolveOutcome(g.signals);
    await db
      .update(replyOutcome)
      .set({ outcome: v.outcome, signals: v.signals, weight: v.weight, resolvedAt: new Date() })
      .where(eq(replyOutcome.messageId, messageId));
    return v;
  }

  return {
    resolve,
    /**
     * Makes a reply the person's own to judge, and judges it now: a pick between two answers of a paired test is the person's word on the
     * reply that had the items. The reply was Zetta's (a saved test); from here it counts like a reply the person read and answered.
     */
    async adopt(messageId: string) {
      const [m] = await db
        .select({ ownerUserId: message.ownerUserId, botId: message.botId })
        .from(message)
        .where(eq(message.id, messageId));
      if (!m?.botId) return undefined;
      await db
        .insert(replyOutcome)
        .values({
          messageId,
          ownerUserId: m.ownerUserId,
          botId: m.botId,
          origin: "person",
          outcome: "pending",
        })
        .onConflictDoUpdate({
          target: replyOutcome.messageId,
          set: { origin: "person", outcome: "pending", resolvedAt: null },
        });
      return resolve(messageId, { force: true });
    },
    /**
     * The 30-second ticker: judges replies that were waiting, and looks again, for a day, at the ones judged before the person's next
     * message arrived (a thumb up first, a correction after it). Old uses are deleted once an hour.
     */
    async tick(now = new Date()) {
      if (busy) return 0;
      busy = true;
      try {
        const young = new Date(now.getTime() - GRACE_MS);
        const day = new Date(now.getTime() - OUTCOME_SETTLE_MS);
        const rows = await db
          .select({ messageId: replyOutcome.messageId })
          .from(replyOutcome)
          .where(
            and(
              lt(replyOutcome.createdAt, young),
              or(
                eq(replyOutcome.outcome, "pending"),
                and(
                  eq(replyOutcome.origin, "person"),
                  gt(replyOutcome.resolvedAt, day),
                  sql`not (${replyOutcome.signals} && array['carried_on','corrected','steered','send_now','interrupted','stopped']::text[])`,
                ),
              ),
            ),
          )
          .orderBy(asc(replyOutcome.createdAt))
          .limit(PER_TICK);
        let n = 0;
        for (const r of rows) if (await resolve(r.messageId).catch(() => undefined)) n++;
        if (now.getTime() - lastPrune > PRUNE_EVERY_MS) {
          lastPrune = now.getTime();
          await db
            .delete(itemUse)
            .where(
              lt(itemUse.createdAt, new Date(now.getTime() - ITEM_USE_KEEP_DAYS * 86_400_000)),
            );
        }
        return n;
      } finally {
        busy = false;
      }
    },
  };
}
export type Outcomes = ReturnType<typeof createOutcomes>;

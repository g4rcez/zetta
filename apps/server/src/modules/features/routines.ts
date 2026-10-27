import type { Database } from "@zetta/db";
import { and, asc, desc, eq, gte, lt, lte, sql } from "@zetta/db/query";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { routine, routineRun, workflow } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { AccessError, type ActiveActor } from "../identity/access";
import { raiseAttention } from "./attention";
import { audit } from "./audit";
import {
  computeNextRun,
  describeSchedule,
  previewRuns,
  validTimezone,
  type Recurrence,
} from "./schedule";

export class RoutineError extends Error {
  constructor(
    readonly code: "NOT_READY" | "INVALID" | "CONFLICT",
    readonly missing: string[] = [],
  ) {
    super(code);
  }
}
type Routine = typeof routine.$inferSelect;
export type RoutineInput = {
  botId: string;
  title: string;
  prompt: string;
  timezone: string;
  dailyAt?: string;
  everyMinutes?: number;
  onceAt?: string;
  conversationMode?: "new" | "continue";
  workflowId?: string;
};
const first = <T>(rows: T[]): T => {
  if (!rows[0]) throw new AccessError("NOT_FOUND");
  return rows[0];
};

type RunTurn = (t: {
  userId: string;
  bot: typeof bot.$inferSelect;
  history: [];
  prompt: string;
}) => Promise<{ text: string }>;
/**
 * Runs the routine's prompt as a real chat turn in that conversation, as the owner: the same tool loop as a person's message (computers,
 * plugins, Agenda, proposals), and the user/assistant messages are saved by the chat itself. `ok` is false for a failed or stopped reply.
 */
export type ChatTurn = (
  userId: string,
  conversationId: string,
  prompt: string,
  requestKey: string,
) => Promise<{ ok: boolean; text: string }>;
export function createRoutines(
  db: Database,
  run: RunTurn,
  runWorkflow: (
    userId: string,
    workflowId: string,
    input: string,
  ) => Promise<{ status: string; output: string }>,
) {
  // Set once the chat service exists (it depends on this module for proposals). Without it, routines run the bare bot without tools.
  let chatTurn: ChatTurn | undefined;
  const usableBot = async (actor: { userId: string }, botId: string) =>
    first(
      await db
        .select()
        .from(bot)
        .where(and(eq(bot.id, botId), eq(bot.archived, false)))
        .then((rows) =>
          rows.filter((b) => b.ownerUserId === actor.userId || b.visibility === "team"),
        ),
    );
  const rec = (r: Routine): Recurrence => ({
    timezone: r.timezone,
    dailyAt: r.dailyAt,
    everyMinutes: r.everyMinutes,
    kind: r.kind,
    onceAt: r.onceAt,
  });

  /** What is still missing before this routine may be activated (shown as a checklist). */
  async function prerequisites(userId: string, r: Pick<Routine, "botId" | "workflowId">) {
    const missing: string[] = [];
    const [b] = await db
      .select()
      .from(bot)
      .where(and(eq(bot.id, r.botId), eq(bot.archived, false)));
    if (!b || (b.ownerUserId !== userId && b.visibility !== "team"))
      missing.push("The bot is not available.");
    else if (!b.onboarded)
      missing.push(
        `${b.name} has not finished onboarding (chat with it and confirm you are satisfied).`,
      );
    else if (b.requiredConnections.length)
      missing.push(
        `${b.name} needs accounts connected: ${b.requiredConnections.map((c) => c.key).join(", ")}.`,
      );
    if (r.workflowId) {
      const [w] = await db
        .select()
        .from(workflow)
        .where(and(eq(workflow.id, r.workflowId), eq(workflow.ownerUserId, userId)));
      if (!w) missing.push("The workflow does not exist.");
    }
    return missing;
  }

  async function active(userId: string) {
    const [m] = await db
      .select({ s: membership.status })
      .from(membership)
      .where(eq(membership.userId, userId));
    return m?.s === "active";
  }

  /** Executes one claimed occurrence row. Never throws: the row ends as succeeded/failed/blocked. */
  async function execute(r: Routine, runId: string, startedAt: Date) {
    const finish = (
      status: "succeeded" | "failed" | "blocked" | "skipped",
      output: string,
      reasonCode: string | null,
      conversationId?: string,
    ) =>
      db
        .update(routineRun)
        .set({
          status,
          output: output.slice(0, 8000),
          reasonCode,
          conversationId: conversationId ?? null,
          finishedAt: new Date(),
        })
        .where(eq(routineRun.id, runId))
        .then(() =>
          audit(db, r.ownerUserId, {
            kind: "routine_run",
            botId: r.botId,
            subjectId: r.id,
            outcome: status === "succeeded" ? "ok" : status === "blocked" ? "denied" : "failed",
            detail: reasonCode ?? status,
          }),
        );
    const block = async (code: string, text: string) => {
      await db.update(routine).set({ paused: true, nextRunAt: null }).where(eq(routine.id, r.id));
      await finish("blocked", text, code);
      await raiseAttention(db, r.ownerUserId, {
        botId: r.botId,
        title: `Routine "${r.title}" paused`,
        detail: text,
        nextAction: "Fix the cause, then activate the routine again.",
        resultLink: `/studio?routine=${r.id}`,
        source: "routine",
        sourceKey: `routine:${r.id}:blocked`,
        remaining: "Next occurrence",
      });
    };
    if (!(await active(r.ownerUserId)))
      return block("owner_inactive", "The routine owner no longer has an active membership.");
    const missing = await prerequisites(r.ownerUserId, r);
    if (missing.length) return block("not_ready", missing[0]!);
    const [b] = await db.select().from(bot).where(eq(bot.id, r.botId));
    // Result destination: a chat the owner can open (new per run, or continuing the routine's chat).
    let convId: string | undefined;
    if (r.conversationMode === "continue") {
      const [last] = await db
        .select({ c: routineRun.conversationId })
        .from(routineRun)
        .where(and(eq(routineRun.routineId, r.id), sql`${routineRun.conversationId} is not null`))
        .orderBy(desc(routineRun.startedAt))
        .limit(1);
      convId = last?.c ?? undefined;
    }
    if (!convId)
      convId = (
        await db
          .insert(conversation)
          .values({
            ownerUserId: r.ownerUserId,
            botId: b!.id,
            title: `${r.title} · ${startedAt.toISOString().slice(0, 16)}`,
          })
          .returning()
      )[0]!.id;
    let status: "succeeded" | "failed" = "succeeded",
      output = "",
      reason: string | null = null;
    if (chatTurn && !r.workflowId) {
      try {
        const t = await chatTurn(r.ownerUserId, convId, r.prompt, `routine:${runId}`);
        output = t.text;
        if (!t.ok) {
          status = "failed";
          reason = "bot_failed";
        }
      } catch {
        status = "failed";
        reason = "bot_failed";
        output = "The routine could not complete.";
      }
    } else {
      try {
        if (r.workflowId) {
          const w = await runWorkflow(r.ownerUserId, r.workflowId, r.prompt);
          output = w.output;
          if (w.status !== "succeeded") {
            status = "failed";
            reason = "workflow_failed";
          }
        } else
          output = (await run({ userId: r.ownerUserId, bot: b!, history: [], prompt: r.prompt }))
            .text;
      } catch {
        status = "failed";
        reason = "bot_failed";
        output = "The routine could not complete.";
      }
      const [{ m } = { m: 0 }] = await db
        .select({ m: sql<number>`coalesce(max(${message.seq}), 0)` })
        .from(message)
        .where(eq(message.conversationId, convId));
      await db.insert(message).values([
        {
          conversationId: convId,
          ownerUserId: r.ownerUserId,
          seq: Number(m) + 1,
          role: "user",
          content: r.prompt,
        },
        {
          conversationId: convId,
          ownerUserId: r.ownerUserId,
          seq: Number(m) + 2,
          role: "assistant",
          content: output,
          status: status === "failed" ? "failed" : "complete",
          botVersion: b!.version,
          botId: b!.id,
        },
      ]);
    }
    await finish(status, output, reason, convId);
    if (status === "failed")
      await raiseAttention(db, r.ownerUserId, {
        botId: b!.id,
        title: `Routine "${r.title}" failed`,
        detail: output,
        nextAction: "Check the bot, then run the routine again.",
        resultLink: `/chat/${convId}`,
        source: "routine",
        sourceKey: `routine:${r.id}:failed`,
        remaining: "This occurrence",
      });
    return;
  }

  /** Claims an occurrence by inserting its unique key first (a crash, retry or second worker cannot run it twice). */
  async function claim(r: Routine, key: string, trigger: "schedule" | "manual", startedAt: Date) {
    const [row] = await db
      .insert(routineRun)
      .values({
        routineId: r.id,
        ownerUserId: r.ownerUserId,
        status: "running",
        output: "",
        occurrenceKey: key,
        trigger,
        startedAt,
      })
      .onConflictDoNothing()
      .returning();
    return row;
  }

  return {
    prerequisites,
    useChat(turn: ChatTurn) {
      chatTurn = turn;
    },
    async create(a: ActiveActor, v: RoutineInput) {
      await usableBot(a, v.botId);
      const kind = v.onceAt ? ("once" as const) : ("recurring" as const);
      if (
        !validTimezone(v.timezone) ||
        (kind === "recurring" && !v.dailyAt && !v.everyMinutes) ||
        (kind === "once" && new Date(v.onceAt!).getTime() <= Date.now())
      )
        throw new RoutineError("INVALID");
      if (v.workflowId)
        first(
          await db
            .select()
            .from(workflow)
            .where(and(eq(workflow.id, v.workflowId), eq(workflow.ownerUserId, a.userId))),
        );
      return first(
        await db
          .insert(routine)
          .values({
            ownerUserId: a.userId,
            botId: v.botId,
            title: v.title,
            prompt: v.prompt,
            timezone: v.timezone,
            dailyAt: v.dailyAt ?? null,
            everyMinutes: v.everyMinutes ?? null,
            kind,
            onceAt: v.onceAt ? new Date(v.onceAt) : null,
            conversationMode: v.conversationMode ?? "new",
            workflowId: v.workflowId ?? null,
          })
          .returning(),
      );
    },
    async update(
      a: ActiveActor,
      id: string,
      expectedVersion: number,
      v: Partial<RoutineInput> & { archived?: boolean },
    ) {
      const [cur] = await db
        .select()
        .from(routine)
        .where(and(eq(routine.id, id), eq(routine.ownerUserId, a.userId)));
      const r = first(cur ? [cur] : []);
      if (v.botId) await usableBot(a, v.botId);
      if (v.timezone && !validTimezone(v.timezone)) throw new RoutineError("INVALID");
      const next = {
        ...v,
        archived: v.archived,
        onceAt: v.onceAt ? new Date(v.onceAt) : undefined,
      };
      const merged = {
        ...r,
        ...Object.fromEntries(Object.entries(next).filter(([, x]) => x !== undefined)),
      } as Routine;
      // The schedule kind follows the fields supplied: a date makes it one-time, a time/interval makes it recurring.
      if (v.onceAt) {
        merged.kind = "once";
        merged.dailyAt = null;
        merged.everyMinutes = null;
      } else if (v.dailyAt || v.everyMinutes) {
        merged.kind = "recurring";
        merged.onceAt = null;
        if (v.dailyAt) merged.everyMinutes = null;
        else merged.dailyAt = null;
      }
      const nextRunAt =
        r.paused || merged.archived ? null : computeNextRun(new Date(), rec(merged));
      const [row] = await db
        .update(routine)
        .set({
          ...Object.fromEntries(Object.entries(next).filter(([, x]) => x !== undefined)),
          kind: merged.kind,
          dailyAt: merged.dailyAt,
          everyMinutes: merged.everyMinutes,
          onceAt: merged.onceAt,
          paused: merged.archived ? true : r.paused,
          nextRunAt,
          version: sql`${routine.version} + 1`,
        })
        .where(
          and(
            eq(routine.id, id),
            eq(routine.ownerUserId, a.userId),
            eq(routine.version, expectedVersion),
          ),
        )
        .returning();
      if (!row) throw new RoutineError("CONFLICT");
      return row;
    },
    /** Everything a person should read before activating: task, owner bot, timezone/next runs, context mode, accounts, destination, blockers. */
    async summary(a: ActiveActor, id: string) {
      const [cur] = await db
        .select()
        .from(routine)
        .where(and(eq(routine.id, id), eq(routine.ownerUserId, a.userId)));
      const r = first(cur ? [cur] : []);
      const [b] = await db.select().from(bot).where(eq(bot.id, r.botId));
      return {
        id: r.id,
        task: r.prompt,
        bot: b?.name ?? "(unavailable)",
        schedule: describeSchedule(rec(r)),
        timezone: r.timezone,
        nextRuns: previewRuns(new Date(), rec(r), 3),
        contextMode:
          r.conversationMode === "new" ? "Each run starts a new chat" : "Runs continue one chat",
        accounts: b?.requiredConnections.map((c) => c.key) ?? [],
        destination: "Results appear as a chat you can open and in the run history",
        missing: await prerequisites(a.userId, r),
        version: r.version,
      };
    },
    /** Month/range view: upcoming occurrences of the user's active routines plus runs that already happened, grouped by UTC date. */
    async calendar(a: ActiveActor, from: Date, to: Date) {
      if (to.getTime() - from.getTime() > 62 * 24 * 3600 * 1000 || to <= from)
        throw new RoutineError("INVALID");
      const mine = await db
        .select()
        .from(routine)
        .where(and(eq(routine.ownerUserId, a.userId), eq(routine.archived, false)));
      const items: {
        at: string;
        routineId: string;
        title: string;
        kind: "scheduled" | "ran";
        status?: string;
      }[] = [];
      const now = new Date();
      for (const r of mine) {
        if (!r.paused) {
          let cursor = from > now ? from : now;
          for (let i = 0; i < 200; i++) {
            const n = computeNextRun(cursor, rec(r));
            if (!n || n > to) break;
            if (n >= from)
              items.push({
                at: n.toISOString(),
                routineId: r.id,
                title: r.title,
                kind: "scheduled",
              });
            cursor = n;
          }
        }
        const past = await db
          .select()
          .from(routineRun)
          .where(
            and(
              eq(routineRun.routineId, r.id),
              eq(routineRun.ownerUserId, a.userId),
              gte(routineRun.startedAt, from),
              lte(routineRun.startedAt, to),
            ),
          )
          .orderBy(desc(routineRun.startedAt))
          .limit(100);
        for (const p of past)
          items.push({
            at: p.startedAt.toISOString(),
            routineId: r.id,
            title: r.title,
            kind: "ran",
            status: p.status,
          });
      }
      items.sort((x, y) => x.at.localeCompare(y.at));
      return { items };
    },
    preview(
      _a: ActiveActor,
      v: { timezone: string; dailyAt?: string; everyMinutes?: number; onceAt?: string },
      count = 3,
    ) {
      if (!validTimezone(v.timezone)) throw new RoutineError("INVALID");
      return previewRuns(
        new Date(),
        {
          timezone: v.timezone,
          dailyAt: v.dailyAt ?? null,
          everyMinutes: v.everyMinutes ?? null,
          kind: v.onceAt ? "once" : "recurring",
          onceAt: v.onceAt ? new Date(v.onceAt) : null,
        },
        Math.min(count, 10),
      );
    },
    list: (a: ActiveActor) =>
      db
        .select()
        .from(routine)
        .where(and(eq(routine.ownerUserId, a.userId), eq(routine.archived, false)))
        .orderBy(asc(routine.createdAt)),
    async setPaused(a: ActiveActor, id: string, paused: boolean) {
      const [cur] = await db
        .select()
        .from(routine)
        .where(and(eq(routine.id, id), eq(routine.ownerUserId, a.userId)));
      const r = first(cur ? [cur] : []);
      if (!paused) {
        const missing = await prerequisites(a.userId, r);
        if (missing.length) throw new RoutineError("NOT_READY", missing);
      }
      return first(
        await db
          .update(routine)
          .set({ paused, nextRunAt: paused ? null : computeNextRun(new Date(), rec(r)) })
          .where(eq(routine.id, id))
          .returning(),
      );
    },
    async remove(a: ActiveActor, id: string) {
      return first(
        await db
          .update(routine)
          .set({ archived: true, paused: true, nextRunAt: null })
          .where(and(eq(routine.id, id), eq(routine.ownerUserId, a.userId)))
          .returning(),
      );
    },
    /** Idempotent with `requestKey`: the same key returns the same occurrence instead of running again. */
    async runNow(a: ActiveActor, id: string, requestKey: string) {
      const [cur] = await db
        .select()
        .from(routine)
        .where(and(eq(routine.id, id), eq(routine.ownerUserId, a.userId)));
      const r = first(cur ? [cur] : []);
      const key = `manual:${requestKey}`;
      const claimed = await claim(r, key, "manual", new Date());
      if (!claimed)
        return first(
          await db
            .select()
            .from(routineRun)
            .where(and(eq(routineRun.routineId, id), eq(routineRun.occurrenceKey, key))),
        );
      await execute(r, claimed.id, claimed.startedAt);
      return first(await db.select().from(routineRun).where(eq(routineRun.id, claimed.id)));
    },
    /** Scheduler tick. Each due occurrence is claimed by its unique (routine, scheduled instant) key, then nextRunAt advances. */
    async runDue(now = new Date()) {
      const due = await db
        .select()
        .from(routine)
        .where(
          and(eq(routine.paused, false), eq(routine.archived, false), lte(routine.nextRunAt, now)),
        );
      let ran = 0;
      for (const r of due) {
        const key = `sched:${r.nextRunAt!.toISOString()}`;
        const claimed = await claim(r, key, "schedule", now);
        const advance =
          r.kind === "once"
            ? { paused: true, nextRunAt: null }
            : { nextRunAt: computeNextRun(now, rec(r)), lastRunAt: now };
        await db
          .update(routine)
          .set(advance)
          .where(and(eq(routine.id, r.id), eq(routine.nextRunAt, r.nextRunAt!)));
        if (!claimed) continue; // another worker (or an earlier crash) already owns this occurrence
        await execute(r, claimed.id, now);
        ran++;
      }
      return ran;
    },
    /** Boot recovery: occurrences left running by a dead process become interrupted, with one attention card per routine. */
    async recoverInterrupted() {
      const rows = await db
        .update(routineRun)
        .set({ status: "interrupted", reasonCode: "process_restart", finishedAt: new Date() })
        .where(eq(routineRun.status, "running"))
        .returning();
      for (const x of rows)
        await raiseAttention(db, x.ownerUserId, {
          title: "A routine run was interrupted by a restart",
          detail: "The server stopped while it was running; the result is uncertain.",
          nextAction: "Open the routine history and run it again if needed.",
          resultLink: `/studio?routine=${x.routineId}`,
          source: "routine",
          sourceKey: `routine:${x.routineId}:interrupted`,
        });
      return rows.length;
    },
    async runs(a: ActiveActor, id: string, opts: { before?: string; limit?: number } = {}) {
      const limit = Math.min(opts.limit ?? 20, 50);
      const rows = await db
        .select()
        .from(routineRun)
        .where(
          and(
            eq(routineRun.routineId, id),
            eq(routineRun.ownerUserId, a.userId),
            opts.before ? lt(routineRun.startedAt, new Date(opts.before)) : undefined,
          ),
        )
        .orderBy(desc(routineRun.startedAt))
        .limit(limit + 1);
      return {
        runs: rows.slice(0, limit),
        nextBefore: rows.length > limit ? rows[limit - 1]!.startedAt.toISOString() : null,
      };
    },
  };
}
export type Routines = ReturnType<typeof createRoutines>;

import type { Database } from "@zetta/db";
import schedule from "node-schedule";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "@zetta/db/query";
import { bot, conversation } from "@zetta/db/schema/chat";
import { routine, routineRun, workflow } from "@zetta/db/schema/features";
import { discussion } from "@zetta/db/schema/discussions";
import { membership } from "@zetta/db/schema/identity";
import { AccessError, type ActiveActor } from "../identity/access";
import { insertMessage } from "../chat/messages";
import { normalizeMentionText } from "../chat/mention-text";
import { failureKind, retryDelayMs } from "../chat/retry";
import { topics } from "@zetta/core/live-topics";
import { runsWork } from "../../role";
import { events } from "../events/bus";
import { raiseAttention } from "./attention";
import { audit } from "./audit";
import {
  computeNextRun,
  describeSchedule,
  previewRuns,
  validTimezone,
  type Recurrence,
} from "./schedule";
import { instanceId, recoverable, type RecoveryScope } from "../runtime/instance";

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
  /** The room whose bot proposed the routine (set by the chat service, never by a client). */
  originDiscussionId?: string;
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
) => Promise<{ ok: boolean; text: string; error?: string | undefined }>;
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

  type RoutineStatus = Routine["status"];
  /** The routine list, the unread runs and the bot's "working" status change together. */
  const changed = (ownerUserId: string) =>
    events.publish([ownerUserId], topics.routines, topics.botStatus);
  const mark = async (id: string, status: RoutineStatus, reason: string | null = null) => {
    const [row] = await db
      .update(routine)
      .set({ status, statusReason: reason, statusAt: new Date() })
      .where(eq(routine.id, id))
      .returning({ ownerUserId: routine.ownerUserId });
    if (row) changed(row.ownerUserId);
  };

  /**
   * Live node-schedule jobs, one per active routine, fired at its stored `nextRunAt`. The database stays the source of truth: jobs are
   * rebuilt from it at boot, so a restart only loses timers, never schedules. Kept on globalThis so a `bun --hot` reload cancels the
   * previous module's jobs instead of stacking a second set.
   */
  const g = globalThis as { zettaRoutineJobs?: Map<string, schedule.Job> };
  const jobs = (g.zettaRoutineJobs ??= new Map());
  const disarm = (id: string) => {
    jobs.get(id)?.cancel();
    jobs.delete(id);
  };
  /** (Re)schedules the routine's next occurrence; a paused, archived or unscheduled routine has no job. */
  function arm(r: Routine) {
    disarm(r.id);
    // An `api` process never fires jobs: the worker finds a new or changed routine on its next sweep.
    if (!runsWork) return;
    if (r.paused || r.archived || !r.nextRunAt) return;
    // node-schedule ignores dates in the past, so an overdue occurrence fires right away.
    const at = r.nextRunAt.getTime() > Date.now() ? r.nextRunAt : new Date(Date.now() + 500);
    const job = schedule.scheduleJob(`routine:${r.id}`, at, () => void fire(r.id).catch(() => {}));
    if (job) jobs.set(r.id, job);
  }

  /** Executes one claimed occurrence row. Never throws: the row ends as succeeded/failed/blocked. */
  async function execute(
    r: Routine,
    runId: string,
    retry?: { prompt: string; conversationId: string | null; attempt: number },
  ) {
    const prompt = retry?.prompt ?? r.prompt;
    const attempt = retry?.attempt ?? 0;
    await mark(r.id, "running");
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
        .then(async () => {
          if (status === "blocked" || status === "failed") return mark(r.id, status, reasonCode);
          // A routine paused in the meantime (or run by hand while paused) goes back to "paused"; a finished one-time routine is completed.
          if (r.kind === "once") return mark(r.id, "completed");
          await db
            .update(routine)
            .set({
              status: sql`case when ${routine.paused} then 'paused' else 'scheduled' end`,
              statusReason: null,
              statusAt: new Date(),
            })
            .where(eq(routine.id, r.id));
        })
        .then(() => changed(r.ownerUserId))
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
      disarm(r.id);
      await db.update(routine).set({ paused: true, nextRunAt: null }).where(eq(routine.id, r.id));
      await finish("blocked", text, code);
      await raiseAttention(db, r.ownerUserId, {
        botId: r.botId,
        title: `Routine "${r.title}" paused`,
        detail: text,
        nextAction: "Fix the cause, then activate the routine again.",
        resultLink: `/routines?routine=${r.id}`,
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
    // Result destination: the routine's one chat the owner can open. Every run appends to it; the bot reads only the previous run (see chatTurn).
    let convId: string | undefined = retry?.conversationId ?? undefined;
    if (!convId) {
      const [last] = await db
        .select({ c: routineRun.conversationId })
        .from(routineRun)
        .innerJoin(conversation, eq(conversation.id, routineRun.conversationId))
        // Only a chat of the routine's current bot: a bot never posts in another bot's chat.
        .where(and(eq(routineRun.routineId, r.id), eq(conversation.botId, r.botId)))
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
            // "manual" so the first turn keeps the routine title instead of renaming the chat to the prompt.
            title: r.title,
            titleSource: "manual",
          })
          .returning()
      )[0]!.id;
    // Link the live chat now so a running occurrence can be opened from the timeline.
    await db.update(routineRun).set({ conversationId: convId }).where(eq(routineRun.id, runId));
    let status: "succeeded" | "failed" = "succeeded",
      output = "",
      reason: string | null = null,
      errCode: string | undefined;
    if (chatTurn && !r.workflowId) {
      try {
        const t = await chatTurn(r.ownerUserId, convId, prompt, `routine:${runId}`);
        output = t.text;
        if (!t.ok) {
          status = "failed";
          reason = "bot_failed";
          errCode = t.error;
        }
      } catch (e) {
        status = "failed";
        reason = "bot_failed";
        errCode = e instanceof Error ? e.message : undefined;
        output = "The routine could not complete.";
      }
    } else {
      try {
        if (r.workflowId) {
          const w = await runWorkflow(r.ownerUserId, r.workflowId, prompt);
          output = w.output;
          if (w.status !== "succeeded") {
            status = "failed";
            reason = "workflow_failed";
          }
        } else output = (await run({ userId: r.ownerUserId, bot: b!, history: [], prompt })).text;
      } catch (e) {
        status = "failed";
        reason = "bot_failed";
        errCode = e instanceof Error ? e.message : undefined;
        output = "The routine could not complete.";
      }
      await insertMessage(db, convId, {
        ownerUserId: r.ownerUserId,
        role: "user",
        content: prompt,
      });
      await insertMessage(db, convId, {
        ownerUserId: r.ownerUserId,
        role: "assistant",
        content: output,
        status: status === "failed" ? "failed" : "complete",
        botVersion: b!.version,
        botId: b!.id,
      });
    }
    await finish(status, output, reason, convId);
    if (status === "failed") {
      // A failed bot run is tried again after a wait (retryDue); the user is asked only when waiting cannot help or the tries ran out.
      // A workflow is not retried: its steps may already have had effects.
      const delay =
        reason === "bot_failed" ? retryDelayMs(failureKind(errCode), attempt + 1) : null;
      if (delay !== null) {
        await db
          .update(routineRun)
          .set({ retryAt: new Date(Date.now() + delay) })
          .where(eq(routineRun.id, runId));
        return;
      }
      await raiseAttention(db, r.ownerUserId, {
        botId: b!.id,
        title: `Routine "${r.title}" failed`,
        detail: attempt ? `${output}\n(after ${attempt + 1} attempts)` : output,
        nextAction: "Check the bot, then run the routine again.",
        resultLink: `/chat/${convId}`,
        source: "routine",
        sourceKey: `routine:${r.id}:failed`,
        remaining: "This occurrence",
      });
    }
    return;
  }

  /** Claims an occurrence by inserting its unique key first (a crash, retry or second worker cannot run it twice). */
  async function claim(
    r: Routine,
    key: string,
    trigger: "schedule" | "manual" | "recovery",
    startedAt: Date,
    attempt = 0,
  ) {
    const [row] = await db
      .insert(routineRun)
      .values({
        routineId: r.id,
        ownerUserId: r.ownerUserId,
        status: "running",
        ownerInstance: instanceId(),
        output: "",
        occurrenceKey: key,
        trigger,
        startedAt,
        attempt,
      })
      .onConflictDoNothing()
      .returning();
    if (row) changed(r.ownerUserId);
    return row;
  }

  /** Claims the routine's due occurrence, advances `nextRunAt` (re-arming the job), then runs it. False when another worker owns it. */
  async function occur(r: Routine, now: Date) {
    const claimed = await claim(r, `sched:${r.nextRunAt!.toISOString()}`, "schedule", now);
    const advance =
      r.kind === "once"
        ? { paused: true, nextRunAt: null }
        : { nextRunAt: computeNextRun(now, rec(r)), lastRunAt: now };
    const [next] = await db
      .update(routine)
      .set(advance)
      .where(and(eq(routine.id, r.id), eq(routine.nextRunAt, r.nextRunAt!)))
      .returning();
    if (next) arm(next);
    if (!claimed) return false; // another worker (or an earlier crash) already owns this occurrence
    await execute(r, claimed.id);
    return true;
  }

  /** The node-schedule callback: re-reads the routine so a pause or edit made since arming wins. */
  async function fire(id: string) {
    const [r] = await db.select().from(routine).where(eq(routine.id, id));
    if (!r || r.paused || r.archived || !r.nextRunAt) return disarm(id);
    await occur(r, new Date(Math.max(Date.now(), r.nextRunAt.getTime())));
  }

  /** Catch-up for occurrences whose job was lost (restart, clock jump): anything overdue runs now. Idempotent through the claim key. */
  async function runDue(now = new Date()) {
    const due = await db
      .select()
      .from(routine)
      .where(
        and(eq(routine.paused, false), eq(routine.archived, false), lte(routine.nextRunAt, now)),
      );
    let ran = 0;
    for (const r of due) if (await occur(r, now)) ran++;
    return ran;
  }

  const recoveryPrompt = (r: Routine, run: typeof routineRun.$inferSelect) =>
    [
      r.prompt,
      "",
      "---",
      `Recovery: your previous run of this routine (started ${run.startedAt.toISOString()}) ${
        run.status === "interrupted"
          ? "was interrupted because the server restarted"
          : `failed${run.reasonCode ? ` (${run.reasonCode})` : ""}`
      }.`,
      run.output ? `What it had produced: ${run.output.slice(0, 1500)}` : "",
      `This is retry ${run.attempt + 1}. Use the zetta-recover-from-failure skill: change approach instead of repeating the step that failed, and save what you learn as a wiki gotcha.`,
      "Check what already happened in this chat, finish only what is missing, and do not repeat actions that already took effect.",
    ]
      .filter((x) => x !== "")
      .join("\n");

  /**
   * Asks the bots to run again: for every routine whose latest run in the last hour failed or was interrupted (and was not followed by a
   * success), start one recovery run in the same chat with a prompt that tells the bot what happened. One retry per run, never a retry
   * of a retry, so a persistent failure does not loop.
   */
  async function recoverRecent(now = new Date(), windowMs = 3600_000, userId?: string) {
    const since = new Date(now.getTime() - windowMs);
    const rows = await db
      .select({ run: routineRun, r: routine })
      .from(routineRun)
      .innerJoin(routine, eq(routine.id, routineRun.routineId))
      .where(
        and(
          gte(routineRun.startedAt, since),
          eq(routine.archived, false),
          userId ? eq(routine.ownerUserId, userId) : undefined,
          sql`${routineRun.trigger} <> 'recovery'`,
          // A run waiting for its backoff belongs to retryDue; retrying it at boot would skip the wait.
          sql`${routineRun.retryAt} is null`,
        ),
      )
      .orderBy(desc(routineRun.startedAt));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const x of rows) if (!latest.has(x.r.id)) latest.set(x.r.id, x);
    const todo = [...latest.values()].filter(
      ({ run, r }) =>
        (run.status === "failed" || run.status === "interrupted") &&
        (!r.paused || r.kind === "once"),
    );
    const results = await Promise.allSettled(
      todo.map(async ({ run, r }) => {
        const claimed = await claim(r, `retry:${run.id}`, "recovery", now);
        if (!claimed) return false;
        await execute(r, claimed.id, {
          prompt: recoveryPrompt(r, run),
          conversationId: run.conversationId,
          attempt: run.attempt + 1,
        });
        return true;
      }),
    );
    return results.filter((x) => x.status === "fulfilled" && x.value).length;
  }

  /** Clears the output text of runs older than 90 days. The run row, status and times stay. */
  async function trimOldOutput(now = new Date()) {
    await db
      .update(routineRun)
      .set({ output: "" })
      .where(
        and(
          lt(routineRun.startedAt, new Date(now.getTime() - 90 * 86_400_000)),
          sql`${routineRun.output} <> ''`,
          sql`${routineRun.status} <> 'running'`,
          isNull(routineRun.retryAt),
        ),
      );
  }

  /**
   * Runs the retries whose wait is over. Each retry claims `retry:<failed run id>`, so a second worker or `recoverRecent` cannot run
   * the same retry twice. A retry that fails again schedules the next one itself, until the delays run out.
   */
  async function retryDue(now = new Date()) {
    const due = await db
      .select({ run: routineRun, r: routine })
      .from(routineRun)
      .innerJoin(routine, eq(routine.id, routineRun.routineId))
      .where(and(eq(routineRun.status, "failed"), lte(routineRun.retryAt, now)));
    let ran = 0;
    for (const { run, r } of due) {
      const eligible = !r.archived && (!r.paused || r.kind === "once");
      const claimed = eligible
        ? await claim(r, `retry:${run.id}`, "recovery", now, run.attempt + 1)
        : undefined;
      await db.update(routineRun).set({ retryAt: null }).where(eq(routineRun.id, run.id));
      if (!claimed) continue;
      await execute(r, claimed.id, {
        prompt: recoveryPrompt(r, run),
        conversationId: run.conversationId,
        attempt: run.attempt + 1,
      });
      ran++;
    }
    return ran;
  }

  return {
    prerequisites,
    recoverRecent,
    retryDue,
    runDue,
    /** Arms a job for every active routine and cancels the rest; also a 5-minute sweep for anything overdue. Call once at boot. */
    async start() {
      const active = await db
        .select()
        .from(routine)
        .where(and(eq(routine.paused, false), eq(routine.archived, false)));
      const keep = new Set(active.map((r) => r.id));
      const keys = Array.from(jobs.keys());
      for (const id of keys) if (!keep.has(id)) disarm(id);
      for (const r of active) arm(r);
      const sweep = globalThis as { zettaRoutineSweep?: schedule.Job | null };
      sweep.zettaRoutineSweep?.cancel();
      sweep.zettaRoutineSweep = schedule.scheduleJob("routine-sweep", "*/5 * * * *", () => {
        void runDue().catch(() => {});
        void retryDue().catch(() => {});
        if (new Date().getMinutes() < 5) void trimOldOutput().catch(() => {}); // once an hour
      });
      return active.length;
    },
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
      // A room the owner does not have is ignored, not an error: the approved routine must still be created.
      const [origin] = v.originDiscussionId
        ? await db
            .select({ id: discussion.id })
            .from(discussion)
            .where(
              and(eq(discussion.id, v.originDiscussionId), eq(discussion.ownerUserId, a.userId)),
            )
        : [];
      return first(
        await db
          .insert(routine)
          .values({
            ownerUserId: a.userId,
            originDiscussionId: origin?.id ?? null,
            botId: v.botId,
            title: v.title,
            // Stored with mention tokens: a routine runs for months, and a rename must not break its prompt.
            prompt: await normalizeMentionText(db, a.userId, v.prompt),
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
        ...(v.prompt !== undefined
          ? { prompt: await normalizeMentionText(db, a.userId, v.prompt) }
          : {}),
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
      arm(row);
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
        contextMode: "All runs share one chat; the bot reads only the run before",
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
      // One query for all routines: the newest 100 runs of each, without the output text.
      const ranked = db
        .select({
          routineId: routineRun.routineId,
          startedAt: routineRun.startedAt,
          status: routineRun.status,
          rn: sql<number>`row_number() over (partition by ${routineRun.routineId} order by ${routineRun.startedAt} desc)`.as(
            "rn",
          ),
        })
        .from(routineRun)
        .where(
          and(
            inArray(
              routineRun.routineId,
              mine.map((r) => r.id),
            ),
            eq(routineRun.ownerUserId, a.userId),
            gte(routineRun.startedAt, from),
            lte(routineRun.startedAt, to),
          ),
        )
        .as("ranked");
      const pastRows = mine.length
        ? await db.select().from(ranked).where(lte(ranked.rn, 100)).orderBy(desc(ranked.startedAt))
        : [];
      const pastByRoutine = Map.groupBy(pastRows, (p) => p.routineId);
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
        const past = pastByRoutine.get(r.id) ?? [];
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
    /** Runs that overlap [from, to], with the ones still running first-class: the timeline draws them up to now. */
    async timeline(a: ActiveActor, from: Date, to: Date) {
      if (to.getTime() - from.getTime() > 7 * 24 * 3600 * 1000 || to <= from)
        throw new RoutineError("INVALID");
      const rows = await db
        .select({ run: routineRun, title: routine.title, botId: routine.botId })
        .from(routineRun)
        .innerJoin(routine, eq(routine.id, routineRun.routineId))
        .where(
          and(
            eq(routineRun.ownerUserId, a.userId),
            lte(routineRun.startedAt, to),
            sql`(${routineRun.finishedAt} is null or ${routineRun.finishedAt} >= ${from})`,
          ),
        )
        .orderBy(asc(routineRun.startedAt))
        .limit(300);
      return {
        runs: rows.map(({ run, title, botId }) => ({
          id: run.id,
          routineId: run.routineId,
          title,
          botId,
          status: run.status,
          trigger: run.trigger,
          conversationId: run.conversationId,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
        })),
      };
    },
    /** Runs the owner has not opened yet (a running one counts as pending), for the Routines badge, with the chats they live in. */
    async unread(a: ActiveActor) {
      const rows = await db
        .select({ conversationId: routineRun.conversationId, runs: sql<number>`count(*)::int` })
        .from(routineRun)
        .where(
          and(
            eq(routineRun.ownerUserId, a.userId),
            isNull(routineRun.readAt),
            sql`${routineRun.conversationId} is not null`,
            sql`${routineRun.status} <> 'skipped'`,
          ),
        )
        .groupBy(routineRun.conversationId);
      return {
        count: rows.reduce((n, r) => n + r.runs, 0),
        conversationIds: rows.map((r) => r.conversationId!),
      };
    },
    /** The owner opened this chat: its finished runs are seen. A run still running stays pending until it ends and the chat is seen again. */
    async markRead(a: ActiveActor, conversationId: string) {
      await db
        .update(routineRun)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(routineRun.ownerUserId, a.userId),
            eq(routineRun.conversationId, conversationId),
            isNull(routineRun.readAt),
            sql`${routineRun.status} <> 'running'`,
          ),
        );
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
    /** Each routine with its one chat: the newest run's conversation (the one `execute` appends to), null before the first run. The outer column is spelled out: Drizzle drops the table name in a one-table select, so `${routine.id}` would read as `rr.id`. */
    /** `state: "active"` leaves out the paused routines; the default lists them all. */
    async list(a: ActiveActor, state: "all" | "active" = "all") {
      const rows = await db
        .select({
          routine,
          conversationId: sql<
            string | null
          >`(select rr.conversation_id from routine_run rr where rr.routine_id = "routine"."id" and rr.conversation_id is not null order by rr.started_at desc limit 1)`,
        })
        .from(routine)
        .where(
          and(
            eq(routine.ownerUserId, a.userId),
            eq(routine.archived, false),
            state === "active" ? eq(routine.paused, false) : undefined,
          ),
        )
        .orderBy(asc(routine.createdAt));
      return rows.map((r) => ({ ...r.routine, conversationId: r.conversationId }));
    },
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
      const row = first(
        await db
          .update(routine)
          .set({
            paused,
            nextRunAt: paused ? null : computeNextRun(new Date(), rec(r)),
            status: paused ? "paused" : "scheduled",
            statusReason: null,
            statusAt: new Date(),
          })
          .where(eq(routine.id, id))
          .returning(),
      );
      arm(row);
      return row;
    },
    async remove(a: ActiveActor, id: string) {
      disarm(id);
      return first(
        await db
          .update(routine)
          .set({
            archived: true,
            paused: true,
            nextRunAt: null,
            status: "paused",
            statusAt: new Date(),
          })
          .where(and(eq(routine.id, id), eq(routine.ownerUserId, a.userId)))
          .returning(),
      );
    },
    /** Archives every live routine of a bot that was deleted, so no armed job fires for it later. */
    async removeForBot(botId: string) {
      const rows = await db
        .update(routine)
        .set({
          archived: true,
          paused: true,
          nextRunAt: null,
          status: "paused",
          statusAt: new Date(),
        })
        .where(and(eq(routine.botId, botId), eq(routine.archived, false)))
        .returning({ id: routine.id });
      for (const r of rows) disarm(r.id);
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
      await execute(r, claimed.id);
      return first(await db.select().from(routineRun).where(eq(routineRun.id, claimed.id)));
    },
    /** Boot recovery: occurrences left running by a dead process become interrupted, with one attention card per routine. */
    async recoverInterrupted(scope?: RecoveryScope) {
      const rows = await db
        .update(routineRun)
        .set({ status: "interrupted", reasonCode: "process_restart", finishedAt: new Date() })
        .where(and(eq(routineRun.status, "running"), recoverable(routineRun.ownerInstance, scope)))
        .returning();
      // Only routines that really had a run in flight; a stale "running" label without one is not an interruption.
      if (rows.length)
        await db
          .update(routine)
          .set({ status: "interrupted", statusReason: "process_restart", statusAt: new Date() })
          .where(
            and(
              eq(routine.status, "running"),
              inArray(routine.id, [...new Set(rows.map((x) => x.routineId))]),
            ),
          );
      const titles = new Map(
        rows.length
          ? (
              await db
                .select({ id: routine.id, title: routine.title })
                .from(routine)
                .where(inArray(routine.id, [...new Set(rows.map((x) => x.routineId))]))
            ).map((t) => [t.id, t.title])
          : [],
      );
      for (const x of rows)
        await raiseAttention(db, x.ownerUserId, {
          title: `Routine "${titles.get(x.routineId) ?? "unnamed"}" was interrupted by a restart`,
          detail: "The server stopped while it was running; the result is uncertain.",
          nextAction: "Open the routine history and run it again if needed.",
          resultLink: `/routines?routine=${x.routineId}`,
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

import { uuidv7 } from "@zetta/core/uuid";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";

import { RoutineError, type RoutineInput } from "../../features/routines";
import { MAX_TRIGGERS, type TriggerInput } from "../../features/routine-triggers";
import { describeSchedule, normalizeWeekdays, validTimezone } from "../../features/schedule";
import { parseScheduleText } from "../../features/schedule-text";
import { pick, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

const when = (r: {
  kind: string;
  dailyAt: string | null;
  weekdays?: number[] | null;
  everyMinutes: number | null;
  onceAt: Date | string | null;
  timezone: string;
}) =>
  describeSchedule({
    timezone: r.timezone,
    dailyAt: r.dailyAt,
    weekdays: r.weekdays,
    everyMinutes: r.everyMinutes,
    kind: r.kind === "once" ? "once" : "recurring",
    onceAt: r.onceAt ? new Date(r.onceAt) : null,
  });

type Scheduled = {
  when?: string | undefined;
  dailyAt?: string | undefined;
  weekdays?: number[] | undefined;
  everyMinutes?: number | undefined;
  onceAt?: string | undefined;
};
/**
 * `when` is the schedule in words ("Monday to Friday at 8:30", "every 15 minutes", a cron). It is read into the same fields the rest of
 * the tool works with, so the card shows the schedule the way every routine is shown. On an update a daily schedule sets `weekdays`
 * (an empty list is every day), so "every day at 8" does not keep the weekday limit the routine had.
 */
function readWhen<A extends Scheduled>(
  a: A,
  timezone: string,
  update: boolean,
): { error: string } | { args: A; assumed: string | null } {
  if (a.when === undefined) return { args: a, assumed: null };
  if (a.dailyAt || a.weekdays || a.everyMinutes || a.onceAt)
    return {
      error:
        "send the schedule either as `when` or as dailyAt, weekdays, everyMinutes or onceAt, not both.",
    };
  const read = parseScheduleText(a.when, { timezone });
  if (!read.ok) return { error: read.problem };
  const { when: _words, ...rest } = a;
  const days = read.schedule.dailyAt && update ? { weekdays: read.schedule.weekdays ?? [] } : {};
  return { args: { ...rest, ...read.schedule, ...days } as unknown as A, assumed: read.assumed };
}

type TriggerArgs = Extract<
  ChiefArgs<"routine">,
  {
    action:
      | "get"
      | "trigger_add"
      | "trigger_pause"
      | "trigger_resume"
      | "trigger_remove"
      | "trigger_rotate";
  }
>;

const TRIGGER_ACTIONS: readonly string[] = [
  "get",
  "trigger_add",
  "trigger_pause",
  "trigger_resume",
  "trigger_remove",
  "trigger_rotate",
];
const isTriggerCall = (a: ChiefArgs<"routine">): a is TriggerArgs =>
  TRIGGER_ACTIONS.includes(a.action);

/** A webhook's secret is shown once, and only to the person: whatever would show it opens a form instead of a card. */
const triggerForm = (r: { id: string; title: string; paused: boolean }, text: string): Outcome => ({
  card: {
    form: "routine_triggers",
    botId: null,
    botName: null,
    prefill: {
      routineId: r.id,
      routineTitle: r.title.slice(0, 120),
      status: r.paused ? "paused" : "active",
    },
  },
  text,
});

/** One routine with its triggers, and the changes to its triggers. Gmail and Home Assistant triggers are cards; webhook ones are a form. */
async function runTrigger(
  ctx: ChiefCtx,
  a: TriggerArgs,
  rows: { id: string; title: string; paused: boolean }[],
): Promise<Outcome> {
  const triggers = ctx.deps.features?.routineTriggers;
  if (!triggers) return { error: "routine triggers are not available on this server." };
  const r = pick(rows, a.routine, (x) => x.title, "routine");
  if ("error" in r) return r;
  const have = await triggers.list(ctx.actor, r.hit.id);
  if (a.action === "get")
    return {
      read: `routine.get:\n${JSON.stringify({
        id: r.hit.id,
        title: r.hit.title,
        paused: r.hit.paused,
        triggers: have.map((t) => ({
          id: t.id,
          kind: t.kind,
          filter: t.filter,
          status: t.status,
          reason: t.statusReason,
        })),
      })}`,
    };
  if (a.action === "trigger_add") {
    if (a.kind === "webhook")
      return triggerForm(
        r.hit,
        "A form is now shown to the user to add the webhook. Its secret is shown only to them, once; you never see it.",
      );
    if (have.length >= MAX_TRIGGERS)
      return {
        error: `"${r.hit.title}" already has ${MAX_TRIGGERS} triggers, the most a routine can have.`,
      };
    const input =
      a.kind === "gmail"
        ? { kind: "gmail" as const, query: a.query! }
        : { kind: "home_assistant" as const, entityId: a.entityId!, ...(a.to ? { to: a.to } : {}) };
    return {
      plan: {
        title: `Add a trigger to routine ${r.hit.title}`,
        diff: [
          { field: "routine", from: null, to: r.hit.title },
          {
            field: "starts it when",
            from: null,
            to:
              input.kind === "gmail"
                ? `a new Gmail message matches "${input.query}"`
                : `${input.entityId} changes${input.to ? ` to ${input.to}` : ""}`,
          },
        ],
        patch: { tool: "routine", op: "trigger_add", id: r.hit.id, input },
      },
    };
  }
  const t = have.find((x) => x.id === a.trigger);
  if (!t) return { error: "no trigger with that id on this routine. Use an id from routine get." };
  const what =
    t.kind === "webhook"
      ? "webhook"
      : t.kind === "gmail"
        ? "Gmail trigger"
        : "Home Assistant trigger";
  if (a.action === "trigger_rotate") {
    if (t.kind !== "webhook") return { error: "only a webhook has a secret to replace." };
    return triggerForm(
      r.hit,
      "A form is now shown to the user to replace the webhook secret. The new secret is shown only to them, once; you never see it.",
    );
  }
  if (a.action === "trigger_remove")
    return {
      plan: {
        title: `Remove a trigger from routine ${r.hit.title}`,
        diff: [{ field: "remove trigger", from: what, to: "the routine no longer starts from it" }],
        patch: { tool: "routine", op: "trigger_remove", id: r.hit.id, triggerId: t.id },
      },
    };
  const to = a.action === "trigger_pause" ? "paused" : "active";
  if (t.status === to) return { error: `That ${what} is already ${to}.` };
  return {
    plan: {
      title: `${to === "paused" ? "Pause" : "Resume"} a trigger of routine ${r.hit.title}`,
      diff: [{ field: what, from: t.status, to }],
      patch: { tool: "routine", op: "trigger_status", id: r.hit.id, triggerId: t.id, status: to },
    },
  };
}

export async function runRoutine(ctx: ChiefCtx, a: ChiefArgs<"routine">): Promise<Outcome> {
  const { routines, db } = ctx.deps;
  if (!routines) return { error: "routines are not available on this server." };
  const bots = await db
    .select()
    .from(bot)
    .where(and(eq(bot.ownerUserId, ctx.actor.userId), eq(bot.archived, false)));
  const botName = (id: string) => bots.find((b) => b.id === id)?.name ?? id;
  const rows = await routines.list(ctx.actor);
  if (a.action === "list")
    return {
      read: `routine.list:\n${JSON.stringify(rows.map((r) => ({ id: r.id, title: r.title, bot: botName(r.botId), schedule: when(r), paused: r.paused, version: r.version })))}`,
    };
  if (isTriggerCall(a)) return runTrigger(ctx, a, rows);
  if (a.action === "create") {
    const b = pick(bots, a.bot, (x) => x.name, "bot");
    if ("error" in b) return b;
    const read = readWhen(a, a.timezone, false);
    if ("error" in read) return read;
    a = read.args;
    if (!a.dailyAt && !a.everyMinutes && !a.onceAt)
      return { error: "give a schedule: dailyAt, everyMinutes or onceAt." };
    if (!validTimezone(a.timezone))
      return { error: `"${a.timezone}" is not an IANA timezone (for example America/Sao_Paulo).` };
    if (a.onceAt && new Date(a.onceAt).getTime() <= Date.now())
      return { error: "onceAt is in the past." };
    const input: RoutineInput = {
      botId: b.hit.id,
      title: a.title,
      prompt: a.prompt,
      timezone: a.timezone,
      ...(a.dailyAt ? { dailyAt: a.dailyAt } : {}),
      ...(a.dailyAt && a.weekdays ? { weekdays: a.weekdays } : {}),
      ...(a.everyMinutes ? { everyMinutes: a.everyMinutes } : {}),
      ...(a.onceAt ? { onceAt: a.onceAt } : {}),
      ...(a.conversationMode ? { conversationMode: a.conversationMode } : {}),
      ...(a.workflowId ? { workflowId: a.workflowId } : {}),
    };
    return {
      plan: {
        title: `New routine ${a.title}`,
        diff: [
          { field: "bot", from: null, to: b.hit.name },
          { field: "title", from: null, to: a.title },
          {
            field: "schedule",
            from: null,
            to: when({
              kind: a.onceAt ? "once" : "recurring",
              dailyAt: a.dailyAt ?? null,
              weekdays: a.dailyAt ? normalizeWeekdays(a.weekdays) : null,
              everyMinutes: a.everyMinutes ?? null,
              onceAt: a.onceAt ?? null,
              timezone: a.timezone,
            }),
          },
          ...(read.assumed ? [{ field: "note", from: null, to: read.assumed }] : []),
          { field: "prompt", from: null, to: short(a.prompt) },
          { field: "switch on", from: null, to: a.activate ? "yes" : "no, it stays paused" },
        ],
        patch: { tool: "routine", op: "create", input, activate: a.activate },
      },
    };
  }
  const r = pick(rows, a.routine, (x) => x.title, "routine");
  if ("error" in r) return r;
  const target = r.hit;
  if (a.action === "pause" || a.action === "resume") {
    const paused = a.action === "pause";
    if (target.paused === paused)
      return { error: `"${target.title}" is already ${paused ? "paused" : "on"}.` };
    return {
      plan: {
        title: `${paused ? "Pause" : "Switch on"} routine ${target.title}`,
        diff: [
          { field: "routine", from: target.paused ? "paused" : "on", to: paused ? "paused" : "on" },
          { field: "name", from: null, to: target.title },
        ],
        patch: { tool: "routine", op: "paused", id: target.id, paused },
      },
    };
  }
  if (a.action === "run_now")
    return {
      plan: {
        title: `Run routine ${target.title} now`,
        diff: [
          {
            field: "run now",
            from: null,
            to: `${target.title} (${botName(target.botId)}) starts one run at once`,
          },
        ],
        patch: { tool: "routine", op: "run", id: target.id },
      },
    };
  if (a.action === "remove")
    return {
      plan: {
        title: `Delete routine ${target.title}`,
        diff: [{ field: "delete routine", from: target.title, to: "deleted" }],
        patch: { tool: "routine", op: "remove", id: target.id },
      },
    };
  // update
  const read = readWhen(a, a.timezone ?? target.timezone, true);
  if ("error" in read) return read;
  a = read.args;
  const changes: Partial<RoutineInput> = {};
  const diff: DiffLine[] = [{ field: "routine", from: null, to: target.title }];
  if (a.bot) {
    const b = pick(bots, a.bot, (x) => x.name, "bot");
    if ("error" in b) return b;
    if (b.hit.id !== target.botId) {
      changes.botId = b.hit.id;
      diff.push({ field: "bot", from: botName(target.botId), to: b.hit.name });
    }
  }
  if (a.timezone && !validTimezone(a.timezone))
    return { error: `"${a.timezone}" is not an IANA timezone.` };
  for (const k of [
    "title",
    "prompt",
    "timezone",
    "dailyAt",
    "everyMinutes",
    "onceAt",
    "conversationMode",
    "workflowId",
  ] as const) {
    const to = a[k];
    if (to === undefined) continue;
    const from = k === "onceAt" ? (target.onceAt ? target.onceAt.toISOString() : null) : target[k];
    if (from === to) continue;
    (changes as Record<string, unknown>)[k] = to;
    diff.push({ field: k, from: short(from), to: short(to) });
  }
  // The days are a list, so they are compared as stored (sorted, null = every day), not with `===`.
  if (a.weekdays !== undefined) {
    const to = normalizeWeekdays(a.weekdays);
    const from = normalizeWeekdays(target.weekdays);
    if (JSON.stringify(to) !== JSON.stringify(from)) {
      changes.weekdays = to ?? [];
      diff.push({
        field: "days",
        from: from ? when({ ...target, weekdays: from }) : "every day",
        to: to ? when({ ...target, weekdays: to }) : "every day",
      });
    }
  }
  if (read.assumed) diff.push({ field: "note", from: null, to: read.assumed });
  if (diff.length === 1 || (diff.length === 2 && read.assumed))
    return { error: `"${target.title}" already has those settings.` };
  return {
    plan: {
      title: `Change routine ${target.title}`,
      diff,
      patch: {
        tool: "routine",
        op: "update",
        id: target.id,
        changes,
        expectedVersion: target.version,
      },
      baseVersion: target.version,
    },
  };
}

export async function applyRoutine(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const { routines } = ctx.deps;
  if (!routines) throw new Error("routines unavailable");
  const v = p as {
    op: string;
    id: string;
    paused: boolean;
    input: RoutineInput | TriggerInput;
    activate: boolean;
    changes: Partial<RoutineInput>;
    expectedVersion: number;
    triggerId: string;
    status: "active" | "paused";
  };
  if (v.op === "trigger_add" || v.op === "trigger_status" || v.op === "trigger_remove") {
    const triggers = ctx.deps.features?.routineTriggers;
    if (!triggers) throw new Error("triggers unavailable");
    if (v.op === "trigger_add") await triggers.create(ctx.actor, v.id, v.input as TriggerInput);
    else if (v.op === "trigger_status")
      await triggers.setStatus(ctx.actor, v.id, v.triggerId, v.status);
    else await triggers.remove(ctx.actor, v.id, v.triggerId);
    return;
  }
  if (v.op === "create") {
    const made = (await routines.create(ctx.actor, v.input as RoutineInput)) as { id: string };
    if (!v.activate) return;
    // The routine exists either way; one that is not ready (the bot needs setup) stays paused and the user is told why.
    try {
      await routines.setPaused(ctx.actor, made.id, false);
    } catch (e) {
      if (e instanceof RoutineError)
        return `The routine was created but stays paused (${e.code}${e.missing.length ? `: ${e.missing.join(", ")}` : ""}).`;
      throw e;
    }
  } else if (v.op === "paused") await routines.setPaused(ctx.actor, v.id, v.paused);
  else if (v.op === "run") await routines.runNow(ctx.actor, v.id, uuidv7());
  else if (v.op === "remove") await routines.remove(ctx.actor, v.id);
  else await routines.update(ctx.actor, v.id, v.expectedVersion, v.changes);
}

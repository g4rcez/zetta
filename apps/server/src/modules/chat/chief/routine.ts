import { uuidv7 } from "@zetta/core/uuid";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";

import { RoutineError, type RoutineInput } from "../../features/routines";
import { validTimezone } from "../../features/schedule";
import { pick, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

const when = (r: {
  kind: string;
  dailyAt: string | null;
  everyMinutes: number | null;
  onceAt: Date | string | null;
  timezone: string;
}) =>
  r.kind === "once"
    ? `once at ${r.onceAt ? new Date(r.onceAt).toISOString() : "?"}`
    : r.dailyAt
      ? `every day at ${r.dailyAt} (${r.timezone})`
      : `every ${r.everyMinutes} minutes`;

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
  if (a.action === "create") {
    const b = pick(bots, a.bot, (x) => x.name, "bot");
    if ("error" in b) return b;
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
              everyMinutes: a.everyMinutes ?? null,
              onceAt: a.onceAt ?? null,
              timezone: a.timezone,
            }),
          },
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
  if (diff.length === 1) return { error: `"${target.title}" already has those settings.` };
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
    input: RoutineInput;
    activate: boolean;
    changes: Partial<RoutineInput>;
    expectedVersion: number;
  };
  if (v.op === "create") {
    const made = (await routines.create(ctx.actor, v.input)) as { id: string };
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

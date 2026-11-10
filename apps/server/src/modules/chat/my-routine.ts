import type { Routines } from "../features/routines";
import { RoutineError } from "../features/routines";
import { parseScheduleText } from "../features/schedule-text";
import type { ActiveActor } from "../identity/access";

/**
 * `zetta:my_routine`: every bot can list and control its OWN routines in words ("pause my morning digest", "skip tomorrow's run",
 * "run it now", "make it weekdays at 9"). A routine of another bot is not visible to it. The Chief keeps its wider `zetta:routine`.
 */
export type MyRoutineArgs =
  | { action: "list" }
  | {
      action: "create";
      title: string;
      prompt: string;
      when: string;
      timezone: string;
    }
  | {
      action: "update";
      id: string;
      title?: string | undefined;
      prompt?: string | undefined;
      when?: string | undefined;
      timezone?: string | undefined;
    }
  | { action: "pause" | "resume" | "run" | "skip_next" | "stop_skip"; id: string };

type Bot = { id: string; name: string };
type Result = { note: string; result: string; routineId?: string };

const line = (r: {
  id: string;
  title: string;
  paused: boolean;
  status?: string | null;
  nextRunAt: Date | string | null;
}) =>
  `- ${r.id} "${r.title}": ${r.paused ? "paused" : (r.status ?? "scheduled")}${r.nextRunAt && !r.paused ? `, next ${new Date(r.nextRunAt).toISOString()}` : ""}`;

export async function runMyRoutine(
  routines: Routines,
  actor: ActiveActor,
  who: Bot,
  a: MyRoutineArgs,
): Promise<Result> {
  const mine = (await routines.list(actor, "all")).filter((r) => r.botId === who.id);
  if (a.action === "list")
    return {
      note: `🗓 Listed ${mine.length} routine${mine.length === 1 ? "" : "s"}.`,
      result: mine.length
        ? `Your routines:\n${mine.map(line).join("\n")}`
        : "You have no routines. Create one with action create.",
    };
  if (a.action === "create") {
    const read = parseScheduleText(a.when, { timezone: a.timezone });
    if (!read.ok)
      return {
        note: `⚠️ Routine not created: ${read.problem}`,
        result: `create refused: ${read.problem}`,
      };
    const made = await routines.create(actor, {
      botId: who.id,
      title: a.title,
      prompt: a.prompt,
      timezone: a.timezone,
      ...read.schedule,
      activate: "on",
    });
    return {
      note: `🗓 Created the routine “${made.title}” (${read.understood})${made.paused ? ", paused: something is missing, see Routines" : ""}.`,
      result: `routine ${made.id} created, ${made.paused ? "paused (not ready)" : "switched on"}; runs ${read.understood}`,
      routineId: made.id,
    };
  }
  const target = mine.find((r) => r.id === a.id);
  if (!target)
    return {
      note: "⚠️ That routine is not one of yours.",
      result: `${a.action} refused: not your routine (list first to get ids)`,
    };
  try {
    // A standing goal is the person's: the bot works on it but never ends it.
    if (a.action === "pause" && target.mode === "goal")
      return {
        note: `⚠️ “${target.title}” is a standing goal: only you can pause it.`,
        result: "pause refused: a standing goal is paused only by its owner",
        routineId: target.id,
      };
    if (a.action === "pause" || a.action === "resume") {
      await routines.setPaused(actor, target.id, a.action === "pause");
      return {
        note: `🗓 ${a.action === "pause" ? "Paused" : "Switched on"} “${target.title}”.`,
        result: `${a.action} ok`,
        routineId: target.id,
      };
    }
    if (a.action === "run") {
      await routines.runNow(actor, target.id, `bot:${who.id}:${Date.now()}`, "background");
      return {
        note: `🗓 Started “${target.title}” now.`,
        result: "run started",
        routineId: target.id,
      };
    }
    if (a.action === "skip_next" || a.action === "stop_skip") {
      if (a.action === "skip_next") await routines.skipNext(actor, target.id);
      else await routines.unskip(actor, target.id);
      return {
        note: `🗓 ${a.action === "skip_next" ? "The next run of" : "No run skipped for"} “${target.title}”${a.action === "skip_next" ? " will be skipped" : ""}.`,
        result: `${a.action} ok`,
        routineId: target.id,
      };
    }
    if (a.action !== "update") throw new RoutineError("INVALID");
    const timezone = a.timezone ?? target.timezone;
    const read = a.when ? parseScheduleText(a.when, { timezone }) : undefined;
    if (read && !read.ok)
      return {
        note: `⚠️ Routine not changed: ${read.problem}`,
        result: `update refused: ${read.problem}`,
      };
    const schedule = read?.ok
      ? {
          ...read.schedule,
          weekdays: read.schedule.weekdays ?? (read.schedule.dailyAt ? [] : undefined),
        }
      : {};
    await routines.update(actor, target.id, target.version, {
      ...(a.title ? { title: a.title } : {}),
      ...(a.prompt ? { prompt: a.prompt } : {}),
      ...(a.timezone ? { timezone: a.timezone } : {}),
      ...schedule,
    });
    return {
      note: `🗓 Changed “${target.title}”${read?.ok ? ` (${read.understood})` : ""}.`,
      result: "update ok",
      routineId: target.id,
    };
  } catch (e) {
    if (e instanceof RoutineError)
      return {
        note: `⚠️ Routine: ${e.code === "NOT_READY" ? e.missing.join(" ") : e.code.toLowerCase()}`,
        result: `${a.action} refused: ${e.code}${e.missing.length ? ` (${e.missing.join("; ")})` : ""}`,
      };
    throw e;
  }
}

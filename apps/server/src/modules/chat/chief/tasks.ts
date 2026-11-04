import type { ApplyCtx, ChiefCtx, Outcome } from "./types";
import type { Applied } from "./types";

/** `zetta:task` remove: the board's bots add and move tasks at once, but deleting one is the chief's and waits for the user. */
export async function runTaskRemove(ctx: ChiefCtx, id: string): Promise<Outcome> {
  const { tasks } = ctx.deps;
  if (!tasks) return { error: "the task board is not available on this server." };
  const t = await tasks.get(ctx.actor, id).catch(() => undefined);
  if (!t) return { error: "no task with that id. Use task list to get ids." };
  return {
    plan: {
      title: `Delete task ${t.title}`,
      diff: [{ field: "delete task", from: t.title, to: "deleted" }],
      patch: { tool: "task", op: "remove", id: t.id },
    },
  };
}

export async function applyTask(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  if (!ctx.deps.tasks) throw new Error("tasks unavailable");
  await ctx.deps.tasks.remove(ctx.actor, String(p.id));
}

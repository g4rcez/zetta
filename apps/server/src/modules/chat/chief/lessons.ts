import { z } from "zod";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

const SAFE = new Set(["unknown_tool", "no_ids", "too_many_ids"]);
const WORDS = {
  keep: "keep",
  drop: "drop",
  restore: "bring back",
  accept: "start on trial",
  reject: "turn down",
} as const;
const clip = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * What the bots learned. A read answers at once; every change is a card the person approves, and nothing is deleted (a dropped lesson is
 * archived and can be brought back). The same tool as the workflows' `zetta` step, so both ways do the same thing.
 */
export async function runLessons(ctx: ChiefCtx, a: ChiefArgs<"lessons">): Promise<Outcome> {
  const lessons = ctx.deps.lessons;
  if (!lessons) return { error: "lessons are not available on this server." };
  const owner = ctx.actor.userId;
  // The service checks this before it gets here; saying it again keeps the tool safe if it is ever called from somewhere else.
  if (ctx.who.kind !== "chief" && a.action !== "list" && a.action !== "stats")
    return { error: "only the Chief can change lessons." };
  if (a.action === "list" || a.action === "stats") {
    const { action, ...args } = a;
    try {
      return { read: `lessons.${action}:\n${await lessons.tools.call(owner, action, args)}` };
    } catch (e) {
      if (e instanceof z.ZodError) return { error: "check the arguments." };
      return { error: e instanceof Error && SAFE.has(e.message) ? e.message : "it did not work." };
    }
  }
  const mine = new Map((await lessons.list(owner, { status: "all" })).map((l) => [l.id, l]));
  const unknown = a.ids.filter((id) => !mine.has(id.toLowerCase()) && !mine.has(id));
  if (unknown.length) return { error: `no lesson of yours has the id ${unknown[0]}. List first.` };
  const chosen = a.ids.map((id) => mine.get(id) ?? mine.get(id.toLowerCase())!);
  const diff: DiffLine[] = chosen.map((l) => ({
    field: `${WORDS[a.action]}`,
    from: l.status,
    to: clip(l.text),
  }));
  return {
    plan: {
      title: `${WORDS[a.action][0]!.toUpperCase()}${WORDS[a.action].slice(1)} ${chosen.length === 1 ? "a lesson" : `${chosen.length} lessons`}`,
      diff,
      patch: { tool: "lessons", op: a.action, ids: chosen.map((l) => l.id) },
    },
  };
}

export async function applyLessons(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const lessons = ctx.deps.lessons;
  if (!lessons) throw new Error("lessons are not available on this server.");
  const v = p as { op: string; ids: string[] };
  const out = await lessons.tools.call(ctx.actor.userId, v.op, { ids: v.ids });
  // One that cannot be done does not stop the others; nothing done at all is a failure the person sees.
  if (out.split("\n").every((l) => l.includes(": not done"))) throw new Error(out);
}

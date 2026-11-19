import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { workflow } from "@zetta/db/schema/features";
import type { ActiveActor } from "../identity/access";
import { LessonError } from "./lessons";

/**
 * "Weekly lesson check": an ordinary workflow, owned by the person, that they can open, change and run like any other. It lists what the
 * bots learned with what happened after each lesson was used, asks the chief which ones to drop, asks the person, and only then drops
 * them. The drop is a tool that changes something, so the workflow cannot be saved without the approval step before it.
 */
export const LESSON_CHECK_NAME = "Weekly lesson check";

type Save = (
  a: ActiveActor,
  v: { name: string; graph: unknown },
) => Promise<{ id: string; name: string }>;

export function createLessonWorkflow(db: Database, deps: { save: Save }) {
  return {
    /** Creates the workflow, or answers with the one the person already has under this name. */
    async ensure(actor: ActiveActor) {
      const [have] = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(and(eq(workflow.ownerUserId, actor.userId), eq(workflow.name, LESSON_CHECK_NAME)));
      if (have) return { id: have.id, created: false as const };
      const [chief] = await db
        .select({ id: bot.id })
        .from(bot)
        .where(
          and(eq(bot.ownerUserId, actor.userId), eq(bot.kind, "chief"), eq(bot.archived, false)),
        );
      if (!chief) throw new LessonError("NOT_FOUND", "You have no Chief bot to run the check.");
      const chiefId = chief.id;
      const w = await deps.save(actor, {
        name: LESSON_CHECK_NAME,
        graph: {
          start: "list",
          nodes: {
            list: {
              type: "tool",
              botId: chiefId,
              kind: "zetta",
              target: "lessons",
              tool: "list",
              args: {},
              next: "pick",
            },
            pick: {
              type: "prompt",
              botId: chiefId,
              template:
                "Below are the lessons my bots follow, each with what happened after it was used (id | status | result | text).\n\n{{prev}}\n\nWhich of them should I drop? Pick only a lesson that hurts, or that nothing used for a long time. Answer with one line per lesson: its id, then a short reason. If none should be dropped, answer exactly NONE.",
              next: "any",
            },
            // `then` is the workflow condition field, not a thenable.
            // oxlint-disable-next-line unicorn/no-thenable
            any: { type: "condition", contains: "NONE", then: "done", else: "ask" },
            ask: {
              type: "approval",
              message:
                "The check picked lessons to drop. Open this run to see which ones: approving drops only those. Nothing is deleted, and you can bring each back from the Lessons page.",
              next: "drop",
            },
            drop: {
              type: "tool",
              botId: chiefId,
              kind: "zetta",
              target: "lessons",
              tool: "drop",
              args: { ids: "{{steps.pick}}" },
              next: "done",
            },
            done: { type: "end" },
          },
        },
      });
      return { id: w.id, created: true as const };
    },
  };
}
export type LessonWorkflow = ReturnType<typeof createLessonWorkflow>;

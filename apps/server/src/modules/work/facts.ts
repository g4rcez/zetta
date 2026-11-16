import type { WorkWorker } from "@zetta/core/work-suggestions";
import type { Database } from "@zetta/db";
import { eq, inArray, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { project, type ProjectWatch } from "@zetta/db/schema/projects";
import { task } from "@zetta/db/schema/tasks";

export type TaskRow = typeof task.$inferSelect;
/** A task with what a work card says about it: who does it, how far it is, whose it is and which project watches it. */
export type TaskFacts = {
  task: TaskRow;
  stepsDone: number;
  stepsTotal: number;
  /** Who does the task. Null when it is nobody's yet (a task from the board with no bot). */
  worker: WorkWorker | null;
  ownerName: string;
  project: { id: string; name: string; watch: ProjectWatch } | null;
};

/** One read per table for any number of tasks. A task that is gone is simply not in the map. */
export async function loadFacts(
  db: Pick<Database, "select">,
  ids: readonly string[],
): Promise<Map<string, TaskFacts>> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return new Map();
  const tasks = await db.select().from(task).where(inArray(task.id, wanted));
  if (!tasks.length) return new Map();
  const botIds = [...new Set(tasks.flatMap((t) => (t.botId ? [t.botId] : [])))];
  const userIds = [
    ...new Set(
      tasks.flatMap((t) => [t.ownerUserId, ...(t.assigneeUserId ? [t.assigneeUserId] : [])]),
    ),
  ];
  const projectIds = [...new Set(tasks.flatMap((t) => (t.projectId ? [t.projectId] : [])))];
  const [bots, users, projects, steps] = await Promise.all([
    botIds.length
      ? db.select({ id: bot.id, name: bot.name }).from(bot).where(inArray(bot.id, botIds))
      : [],
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
    projectIds.length
      ? db
          .select({ id: project.id, name: project.name, watch: project.watch })
          .from(project)
          .where(inArray(project.id, projectIds))
      : [],
    db
      .select({
        parentId: task.parentTaskId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${task.status} = 'done')::int`,
      })
      .from(task)
      .where(
        inArray(
          task.parentTaskId,
          tasks.map((t) => t.id),
        ),
      )
      .groupBy(task.parentTaskId),
  ]);
  const botName = new Map(bots.map((b) => [b.id, b.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const stepsOf = new Map(steps.map((s) => [s.parentId, s]));
  return new Map(
    tasks.map((t) => [
      t.id,
      {
        task: t,
        stepsDone: stepsOf.get(t.id)?.done ?? 0,
        stepsTotal: stepsOf.get(t.id)?.total ?? 0,
        worker:
          t.assignee === "person" && t.assigneeUserId
            ? {
                kind: "person" as const,
                id: t.assigneeUserId,
                name: userName.get(t.assigneeUserId) ?? "Someone",
              }
            : t.botId
              ? { kind: "bot" as const, id: t.botId, name: botName.get(t.botId) ?? "A bot" }
              : null,
        ownerName: userName.get(t.ownerUserId) ?? "Your manager",
        project: (t.projectId && projectOf.get(t.projectId)) || null,
      },
    ]),
  );
}

/** One task's facts, or undefined when it is gone. */
export const factsOf = async (db: Pick<Database, "select">, id: string) =>
  (await loadFacts(db, [id])).get(id);

/** What a task looks like right now, to tell later whether it changed. */
export const fingerprintOf = (t: Pick<TaskRow, "status" | "updatedAt" | "followUp">) =>
  `${t.status}:${t.followUp}:${+t.updatedAt}`;

export const taskOwner = (db: Pick<Database, "select">, id: string) =>
  db.select({ ownerUserId: task.ownerUserId }).from(task).where(eq(task.id, id));

import type { Database } from "@zetta/db";
import { and, desc, eq } from "@zetta/db/query";
import { task, TASK_STATUSES, type TaskStatus } from "@zetta/db/schema/tasks";
import { AccessError, type ActiveActor } from "../identity/access";

export { TASK_STATUSES };
export type Task = typeof task.$inferSelect;
/** Trusted server values for where a task came from (never request input). */
export type TaskOrigin = {
  botId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
};

export function createTaskStore(db: Database) {
  const mine = (a: ActiveActor, id: string) => and(eq(task.id, id), eq(task.ownerUserId, a.userId));
  return {
    list: (a: ActiveActor) =>
      db.select().from(task).where(eq(task.ownerUserId, a.userId)).orderBy(desc(task.updatedAt)),
    async create(
      a: ActiveActor,
      v: { title: string; description?: string; status?: TaskStatus },
      origin: TaskOrigin = {},
    ) {
      const [row] = await db
        .insert(task)
        .values({ ownerUserId: a.userId, ...v, ...origin })
        .returning();
      return row!;
    },
    async update(
      a: ActiveActor,
      id: string,
      v: { title?: string; description?: string; status?: TaskStatus },
    ) {
      const [row] = await db
        .update(task)
        .set({ ...v, updatedAt: new Date() })
        .where(mine(a, id))
        .returning();
      if (!row) throw new AccessError("NOT_FOUND");
      return row;
    },
    async remove(a: ActiveActor, id: string) {
      const [row] = await db.delete(task).where(mine(a, id)).returning();
      if (!row) throw new AccessError("NOT_FOUND");
      return row;
    },
  };
}
export type TaskStore = ReturnType<typeof createTaskStore>;

import type { Database } from "@zetta/db";
import { and, desc, eq, getTableColumns, inArray, ne, or, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { team } from "@zetta/db/schema/teams";
import {
  task,
  TASK_ASSIGNEES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@zetta/db/schema/tasks";
import { closeAttentionKey, raiseAttention } from "../features/attention";
import { AccessError, type ActiveActor } from "../identity/access";
import { createTeamPeople } from "../teams/people";

export { TASK_ASSIGNEES, TASK_PRIORITIES, TASK_STATUSES };
/** A task as the board shows it: `assigneeName` is the person it is assigned to, when it is a person task. */
export type Task = typeof task.$inferSelect & { assigneeName: string | null };
type TaskFields = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
};
/** Trusted server values for where a task came from (never request input). */
export type TaskOrigin = {
  botId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
};
/** A bot needs something from a person. `teamId` is the team through which a person who is not the owner sees the task. */
export type TaskAsk = TaskFields & {
  title: string;
  assigneeUserId: string;
  teamId?: string | null;
  botId?: string | null;
  conversationId?: string | null;
  /** Shown on the assignee's attention card. */
  nextAction?: string;
  /** "none" when another card already tells the person (for example a loop paused for them). */
  attention?: "raise" | "none";
};

/** A person moved, or deleted, a task a bot asked for. `by` is who did it: the person, or the owner. */
export type PersonTaskEvent =
  | { kind: "status"; task: Task; from: TaskStatus; to: TaskStatus; by: string }
  | { kind: "removed"; task: Task; by: string };

const cardKey = (id: string) => `task:${id}`;

export function createTaskStore(db: Database) {
  const people = createTeamPeople(db);
  const mine = (a: ActiveActor, id: string) => and(eq(task.id, id), eq(task.ownerUserId, a.userId));
  /** The owner, or the person the task is assigned to while they are still in the team that shares it. */
  const visible = (a: ActiveActor) =>
    or(
      eq(task.ownerUserId, a.userId),
      and(eq(task.assigneeUserId, a.userId), inArray(task.teamId, people.teamIds(a.userId))),
    )!;
  const withName = () =>
    db
      .select({ ...getTableColumns(task), assigneeName: user.name })
      .from(task)
      .leftJoin(user, eq(user.id, task.assigneeUserId));
  async function get(a: ActiveActor, id: string): Promise<Task> {
    const [row] = await withName().where(and(eq(task.id, id), visible(a)));
    if (!row) throw new AccessError("NOT_FOUND");
    return row;
  }
  /** The owner can ask themselves; anyone else must be a live person of an active team of the owner. */
  async function allowed(owner: ActiveActor, assigneeUserId: string, teamId: string | null) {
    if (assigneeUserId === owner.userId) return true;
    if (!teamId) return false;
    const [own] = await db
      .select({ id: team.id })
      .from(team)
      .where(
        and(eq(team.id, teamId), eq(team.ownerUserId, owner.userId), eq(team.status, "active")),
      );
    return !!own && (await people.isPerson(assigneeUserId, teamId));
  }
  const store = {
    /** Set by the chat service: tells the bot that asked. A failing listener never breaks the write that raised it. */
    onPersonTask: undefined as ((e: PersonTaskEvent) => void) | undefined,
    list: (a: ActiveActor): Promise<Task[]> =>
      withName().where(visible(a)).orderBy(desc(task.updatedAt)),
    get,
    async create(a: ActiveActor, v: TaskFields & { title: string }, origin: TaskOrigin = {}) {
      const [row] = await db
        .insert(task)
        .values({ ownerUserId: a.userId, ...v, ...origin })
        .returning();
      return row!;
    },
    /**
     * A bot needs something from a person, so the person gets a task and a card that links to it. Asking again for the same
     * thing (same person, bot, chat and title) updates the open task instead of adding another one.
     */
    async ask(owner: ActiveActor, v: TaskAsk) {
      const { assigneeUserId, botId = null, conversationId = null, nextAction = "", ...rest } = v;
      const { attention = "raise", teamId: asked = null, ...fields } = rest;
      const teamId = assigneeUserId === owner.userId ? null : asked;
      if (!(await allowed(owner, assigneeUserId, teamId))) throw new AccessError("ACCESS_DENIED");
      const [open] = await db
        .select({ id: task.id })
        .from(task)
        .where(
          and(
            eq(task.ownerUserId, owner.userId),
            eq(task.assignee, "person"),
            eq(task.assigneeUserId, assigneeUserId),
            eq(task.title, fields.title),
            sql`${task.botId} is not distinct from ${botId}`,
            sql`${task.conversationId} is not distinct from ${conversationId}`,
            ne(task.status, "done"),
          ),
        )
        .limit(1);
      const [row] = open
        ? await db
            .update(task)
            .set({ ...fields, teamId, status: "backlog", updatedAt: new Date() })
            .where(eq(task.id, open.id))
            .returning()
        : await db
            .insert(task)
            .values({
              ownerUserId: owner.userId,
              ...fields,
              assignee: "person",
              assigneeUserId,
              teamId,
              botId,
              conversationId,
            })
            .returning();
      if (attention === "raise")
        await raiseAttention(db, assigneeUserId, {
          botId,
          title: row!.title,
          detail: row!.description,
          nextAction,
          resultLink: `/tasks/${row!.id}`,
          source: "bot",
          sourceKey: cardKey(row!.id),
        });
      return row!;
    },
    /**
     * The owner changes anything; a person the task is assigned to changes only its status. A status change on a task a bot asked for
     * is reported to `onPersonTask`, except when the bot made it (`by: "bot"`): the bot does not wake itself.
     */
    async update(a: ActiveActor, id: string, v: TaskFields, opts: { by?: "bot" } = {}) {
      const current = await get(a, id);
      if (
        current.ownerUserId !== a.userId &&
        Object.entries(v).some(([key, value]) => key !== "status" && value !== undefined)
      )
        throw new AccessError("ACCESS_DENIED");
      const [row] = await db
        .update(task)
        .set({ ...v, updatedAt: new Date() })
        .where(and(eq(task.id, id), visible(a)))
        .returning();
      if (!row) throw new AccessError("NOT_FOUND");
      if (v.status === "done" && row.assigneeUserId)
        await closeAttentionKey(db, row.assigneeUserId, cardKey(id), "resolved");
      const saved = await get(a, id);
      if (
        current.assignee === "person" &&
        v.status !== undefined &&
        v.status !== current.status &&
        opts.by !== "bot"
      )
        notify({ kind: "status", task: saved, from: current.status, to: v.status, by: a.userId });
      return saved;
    },
    async remove(a: ActiveActor, id: string) {
      const [row] = await db.delete(task).where(mine(a, id)).returning();
      if (!row) throw new AccessError("NOT_FOUND");
      if (row.assigneeUserId)
        await closeAttentionKey(db, row.assigneeUserId, cardKey(id), "cancelled");
      if (row.assignee === "person")
        notify({ kind: "removed", task: { ...row, assigneeName: null }, by: a.userId });
      return row;
    },
  };
  function notify(e: PersonTaskEvent) {
    try {
      store.onPersonTask?.(e);
    } catch {
      // The write already happened: telling the bot is best effort.
    }
  }
  return store;
}
export type TaskStore = ReturnType<typeof createTaskStore>;

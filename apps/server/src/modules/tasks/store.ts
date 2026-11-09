import type { Database } from "@zetta/db";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { message } from "@zetta/db/schema/chat";
import { team } from "@zetta/db/schema/teams";
import {
  task,
  TASK_ASSIGNEES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskFollowUp,
  type TaskPriority,
  type TaskStatus,
} from "@zetta/db/schema/tasks";
import { closeAttentionKey, raiseAttention } from "../features/attention";
import { AccessError, type ActiveActor } from "../identity/access";
import { instanceId, recoverable } from "../runtime/instance";
import { createTeamPeople } from "../teams/people";
import {
  MAX_CHECK_AHEAD_MS,
  MAX_SUBTASKS,
  MAX_SUBTASKS_PER_ADD,
  OPEN_STATUSES,
  PROGRESS_MAX,
  QUIET_MS,
  TaskRuleError,
} from "./follow-up";

export { TASK_ASSIGNEES, TASK_PRIORITIES, TASK_STATUSES };
/** A task as the board shows it: `assigneeName` is the person it is assigned to, when it is a person task. */
export type Task = typeof task.$inferSelect & { assigneeName: string | null };
/** A top-level task with its subtasks (oldest first), as a bot reads the board. */
export type TaskWithSubtasks = Task & { subtasks: Task[] };

const isOpen = (status: TaskStatus) => (OPEN_STATUSES as readonly string[]).includes(status);

/** Creation order. Subtasks added in one statement share `createdAt`, and UUID v7 ids grow within a session, so the id breaks the tie. */
const byCreation = (x: Task, y: Task) => +x.createdAt - +y.createdAt || (x.id < y.id ? -1 : 1);

/** Groups a flat list: subtasks go under their parent. A subtask whose parent is not in the list (not visible) is left out. */
export function nestTasks(rows: Task[]): TaskWithSubtasks[] {
  const kids = new Map<string, Task[]>();
  for (const r of rows)
    if (r.parentTaskId) kids.set(r.parentTaskId, [...(kids.get(r.parentTaskId) ?? []), r]);
  return rows
    .filter((r) => !r.parentTaskId)
    .map((r) => ({
      ...r,
      subtasks: (kids.get(r.id) ?? []).sort(byCreation),
    }));
}
type TaskFields = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  /** The bot's note on what is done and what comes next (see `task.progress`). */
  progress?: string;
  followUp?: TaskFollowUp;
  followUpReason?: string | null;
  /** When the heartbeat calls the bot back. The store clamps it to the next 7 days. */
  nextCheckAt?: Date | null;
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
/** The attention card the heartbeat raises when it pauses a followed task (chat/task-heartbeat.ts). */
export const followKey = (id: string) => `task-follow:${id}`;

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
  /** Keeps the progress note inside its limit. */
  function cleanFields<T extends TaskFields>(v: T): T {
    return v.progress === undefined ? v : { ...v, progress: v.progress.slice(0, PROGRESS_MAX) };
  }
  /** The parent of a new subtask, if it may have one more: it is the owner's, it is top level and it has room. */
  async function subtaskParent(a: ActiveActor, parentId: string, adding: number) {
    const [parent] = await db.select().from(task).where(mine(a, parentId));
    if (!parent) throw new AccessError("NOT_FOUND");
    if (parent.parentTaskId)
      throw new TaskRuleError(
        "SUBTASK_OF_SUBTASK",
        "A subtask cannot have subtasks: add it to the parent task instead.",
      );
    const [{ n = 0 } = {}] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(task)
      .where(eq(task.parentTaskId, parentId));
    if (n + adding > MAX_SUBTASKS)
      throw new TaskRuleError(
        "TOO_MANY_SUBTASKS",
        `A task has at most ${MAX_SUBTASKS} subtasks; close or remove some first.`,
      );
    return parent;
  }
  const store = {
    /** Set by the chat service: tells the bot that asked. A failing listener never breaks the write that raised it. */
    onPersonTask: undefined as ((e: PersonTaskEvent) => void) | undefined,
    list: (a: ActiveActor): Promise<Task[]> =>
      withName().where(visible(a)).orderBy(desc(task.updatedAt)),
    get,
    /**
     * A task for the board. With `parentTaskId` it is a subtask: one level only, at most 30 per parent, never followed by itself, and it
     * takes the bot, chat and message of its parent unless `origin` says otherwise.
     */
    async create(
      a: ActiveActor,
      v: TaskFields & { title: string; parentTaskId?: string },
      origin: TaskOrigin = {},
    ) {
      const { parentTaskId, ...fields } = v;
      if (!parentTaskId) {
        const [row] = await db
          .insert(task)
          .values({ ownerUserId: a.userId, ...cleanFields(fields), ...origin })
          .returning();
        return row!;
      }
      const parent = await subtaskParent(a, parentTaskId, 1);
      const [row] = await db
        .insert(task)
        .values({
          ownerUserId: a.userId,
          ...cleanFields(fields),
          followUp: "off",
          nextCheckAt: null,
          parentTaskId,
          botId: origin.botId ?? parent.botId,
          conversationId: origin.conversationId ?? parent.conversationId,
          messageId: origin.messageId ?? parent.messageId,
        })
        .returning();
      await db.update(task).set({ updatedAt: new Date() }).where(eq(task.id, parentTaskId));
      return row!;
    },
    /** A task and its plan in one write: the parent first, then one subtask per title, all in the parent's chat. */
    async createWithSubtasks(
      a: ActiveActor,
      v: TaskFields & { title: string },
      subtasks: string[],
      origin: TaskOrigin = {},
    ) {
      if (subtasks.length > MAX_SUBTASKS_PER_ADD)
        throw new TaskRuleError(
          "TOO_MANY_SUBTASKS",
          `At most ${MAX_SUBTASKS_PER_ADD} subtasks in one add; group the rest into bigger steps.`,
        );
      return db.transaction(async (tx) => {
        const [parent] = await tx
          .insert(task)
          .values({ ownerUserId: a.userId, ...cleanFields(v), ...origin })
          .returning();
        const children = subtasks.length
          ? await tx
              .insert(task)
              .values(
                subtasks.map((title) => ({
                  ownerUserId: a.userId,
                  title,
                  followUp: "off" as const,
                  parentTaskId: parent!.id,
                  botId: parent!.botId,
                  conversationId: parent!.conversationId,
                  messageId: parent!.messageId,
                })),
              )
              .returning()
          : [];
        return { task: parent!, subtasks: children };
      });
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
      const patch: Partial<typeof task.$inferInsert> = { ...cleanFields(v), updatedAt: new Date() };
      const now = Date.now();
      const status = v.status ?? current.status;
      const follow = v.followUp ?? current.followUp;
      if (current.parentTaskId && ((v.followUp && v.followUp !== "off") || v.nextCheckAt))
        throw new TaskRuleError(
          "SUBTASK_FOLLOW_UP",
          "Only the parent task is followed: set followUp or checkAt on the parent.",
        );
      if (v.nextCheckAt) {
        if (+v.nextCheckAt > now + MAX_CHECK_AHEAD_MS)
          throw new TaskRuleError("BAD_CHECK_TIME", "checkAt can be at most 7 days from now.");
        patch.nextCheckAt = new Date(Math.max(+v.nextCheckAt, now));
      }
      if (v.status === "done" && !current.parentTaskId) {
        const open = await db
          .select({ title: task.title })
          .from(task)
          .where(and(eq(task.parentTaskId, id), ne(task.status, "done")));
        if (open.length)
          throw new TaskRuleError(
            "OPEN_SUBTASKS",
            `Subtasks still open: ${open.map((x) => `“${x.title}”`).join(", ")}. Finish them, or remove the ones that no longer apply, before closing the task.`,
          );
        // A finished task is not followed: reopening it starts a new follow-up on purpose.
        Object.assign(patch, { followUp: "off", nextCheckAt: null, followUpReason: null });
      } else if (v.followUp === "auto") {
        // Following again (the bot asked, or the user pressed Resume): the counters start over. A task that hit the check cap starts its checks over too.
        Object.assign(patch, { stalls: 0, failures: 0, followUpReason: null });
        if (current.followUp === "paused") patch.checks = 0;
      } else if (v.followUp === "off") {
        Object.assign(patch, { nextCheckAt: null });
        if (v.followUpReason === undefined) patch.followUpReason = null;
      }
      // Following a task that is (again) open work: the first check waits for a quiet chat.
      if (
        follow === "auto" &&
        isOpen(status) &&
        patch.nextCheckAt === undefined &&
        (!current.nextCheckAt || v.followUp === "auto" || !isOpen(current.status))
      )
        patch.nextCheckAt = new Date(now + QUIET_MS);
      const [row] = await db
        .update(task)
        .set(patch)
        .where(and(eq(task.id, id), visible(a)))
        .returning();
      if (!row) throw new AccessError("NOT_FOUND");
      if (row.parentTaskId)
        await db.update(task).set({ updatedAt: new Date() }).where(eq(task.id, row.parentTaskId));
      if (v.status === "done" && row.assigneeUserId)
        await closeAttentionKey(db, row.assigneeUserId, cardKey(id), "resolved");
      // "A bot stopped before finishing a task" is answered once the follow-up goes on, is turned off or the task is done.
      if (v.followUp === "auto" || v.followUp === "off" || v.status === "done")
        await closeAttentionKey(db, row.ownerUserId, followKey(id), "resolved");
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
    /** The subtasks of a task, oldest first. */
    subtasks: (a: ActiveActor, parentId: string): Promise<Task[]> =>
      withName()
        .where(and(eq(task.parentTaskId, parentId), visible(a)))
        .orderBy(asc(task.createdAt), asc(task.id)),
    // ---- The follow-up heartbeat (chat/task-heartbeat.ts). These run as the server, never as a request. ----
    /** Followed top-level tasks whose next check has come. The heartbeat still checks the chat and the owner before it acts. */
    due(now = new Date()) {
      return db
        .select()
        .from(task)
        .where(
          and(
            eq(task.followUp, "auto"),
            isNull(task.parentTaskId),
            inArray(task.status, [...OPEN_STATUSES]),
            isNotNull(task.botId),
            isNotNull(task.conversationId),
            lte(task.nextCheckAt, now),
          ),
        )
        .orderBy(asc(task.nextCheckAt))
        .limit(50);
    },
    /** The open tasks this bot follows in this chat (what a checkpoint tells it to save its place in). */
    followedBy(botId: string, conversationId: string) {
      return db
        .select({ id: task.id, title: task.title })
        .from(task)
        .where(
          and(
            eq(task.botId, botId),
            eq(task.conversationId, conversationId),
            eq(task.followUp, "auto"),
            isNull(task.parentTaskId),
            inArray(task.status, [...OPEN_STATUSES]),
          ),
        )
        .limit(5);
    },
    /** The user's words that started a bot task: the message it is linked to (empty when it has none). */
    async requestOf(t: { messageId: string | null }) {
      if (!t.messageId) return "";
      const [m] = await db
        .select({ content: message.content })
        .from(message)
        .where(eq(message.id, t.messageId));
      return (m?.content ?? "").slice(0, 4000);
    },
    /** A task as the heartbeat reads it, with its steps, whatever its owner (the server acts for the owner). */
    async plan(id: string) {
      const [row] = await db.select().from(task).where(eq(task.id, id));
      if (!row) return undefined;
      const steps = await db
        .select()
        .from(task)
        .where(eq(task.parentTaskId, id))
        .orderBy(asc(task.createdAt), asc(task.id));
      return { task: row, steps };
    },
    /**
     * Takes the lease of a followed task: the one instance that checks it. It succeeds when nobody holds it, this instance holds it or the
     * holder is dead. Without a registered instance (tests) there is one driver, so it always succeeds.
     */
    async claim(id: string) {
      const me = instanceId();
      if (!me) return true;
      const rows = await db
        .update(task)
        .set({ ownerInstance: me })
        .where(
          and(
            eq(task.id, id),
            eq(task.followUp, "auto"),
            or(eq(task.ownerInstance, me), recoverable(task.ownerInstance, { unowned: true })),
          ),
        )
        .returning({ id: task.id });
      return rows.length > 0;
    },
    async release(id: string) {
      const me = instanceId();
      if (!me) return;
      await db
        .update(task)
        .set({ ownerInstance: null })
        .where(and(eq(task.id, id), eq(task.ownerInstance, me)));
    },
    /** Moves the next check without counting it (the chat is busy, a loop covers the bot, the agents are paused). */
    async postpone(id: string, ms: number) {
      await db
        .update(task)
        .set({ nextCheckAt: new Date(Date.now() + ms) })
        .where(and(eq(task.id, id), eq(task.followUp, "auto")));
    },
    /** What a check leaves on the task: the counters, when to look again and, while it retries, why. Does not touch `updatedAt`. */
    async finishCheck(
      id: string,
      patch: {
        checks: number;
        stalls: number;
        failures: number;
        nextCheckAt: Date | null;
        followUpReason: string | null;
      },
    ) {
      await db
        .update(task)
        .set(patch)
        .where(and(eq(task.id, id), eq(task.followUp, "auto")));
    },
    /** The server stops following a task (no progress, failures, the cap, the user pressed Stop). The reason shows on the task. */
    async pauseFollowUp(id: string, reason: string) {
      const [row] = await db
        .update(task)
        .set({
          followUp: "paused",
          followUpReason: reason,
          nextCheckAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(task.id, id), eq(task.followUp, "auto")))
        .returning();
      return row;
    },
    /** The user pressed Stop in a chat: everything its bot follows there pauses. */
    async pauseFollowUps(
      ownerUserId: string,
      botId: string,
      conversationId: string,
      reason: string,
    ) {
      return db
        .update(task)
        .set({
          followUp: "paused",
          followUpReason: reason,
          nextCheckAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(task.ownerUserId, ownerUserId),
            eq(task.botId, botId),
            eq(task.conversationId, conversationId),
            eq(task.followUp, "auto"),
            isNull(task.parentTaskId),
          ),
        )
        .returning({ id: task.id });
    },
    /** A turn of this bot in this chat just ended: its followed tasks wait for the chat to be quiet before the next check. */
    async quiet(ownerUserId: string, botId: string, conversationId: string) {
      const until = new Date(Date.now() + QUIET_MS);
      await db
        .update(task)
        .set({ nextCheckAt: until })
        .where(
          and(
            eq(task.ownerUserId, ownerUserId),
            eq(task.botId, botId),
            eq(task.conversationId, conversationId),
            eq(task.followUp, "auto"),
            isNull(task.parentTaskId),
            inArray(task.status, [...OPEN_STATUSES]),
            or(isNull(task.nextCheckAt), sql`${task.nextCheckAt} < ${until}`),
          ),
        );
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

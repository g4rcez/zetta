import { QUEUE_KINDS } from "@zetta/core/attention-kinds";
import { projectHealth, type ProjectHealth } from "@zetta/core/projects";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { discussion } from "@zetta/db/schema/discussions";
import { attentionItem } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { memoryItem, memoryItemProject } from "@zetta/db/schema/memory";
import {
  project,
  projectMember,
  type ProjectStatus,
  type ProjectWatch,
} from "@zetta/db/schema/projects";
import { task, TASK_STATUSES, type TaskStatus } from "@zetta/db/schema/tasks";
import { teamPerson } from "@zetta/db/schema/teams";
import { AccessError, type ActiveActor } from "../identity/access";
import { createTeamPeople } from "../teams/people";

export const MAX_PROJECT_BOTS = 30;
export const MAX_PROJECT_PEOPLE = 30;
export const MAX_PROJECT_ROOMS = 30;
/** How far back "done this week" looks. */
const SHIPPED_MS = 7 * 24 * 60 * 60_000;

/** Why a project rule refused a change. The message is shown to the person as it is. */
export class ProjectRuleError extends Error {
  constructor(
    readonly code: "NAME_TAKEN" | "BAD_MEMBER" | "BAD_ROOM" | "TOO_MANY",
    message: string,
  ) {
    super(message);
    this.name = "ProjectRuleError";
  }
}

type ProjectRow = typeof project.$inferSelect;
export type ProjectFields = {
  name?: string;
  outcome?: string;
  audience?: string;
  doneWhen?: string;
  notIncluded?: string;
  labels?: string[];
  status?: ProjectStatus;
  watch?: ProjectWatch;
};
export type ProjectMembers = { bots: string[]; people: string[] };
export type ProjectCounts = Record<TaskStatus, number> & { total: number };

/** A project as the list shows it. `role` is who is reading: the owner manages it, a member only reads. */
export type ProjectSummary = ProjectRow & {
  role: "owner" | "member";
  bots: { id: string; name: string }[];
  people: { userId: string; name: string }[];
  counts: ProjectCounts;
  health: ProjectHealth;
};

/** Why a task is waiting on the manager. "card": a card in the Inbox says so; the others are read from the task itself. */
export type NeedsYouWhy = "card" | "blocked" | "review";
export type NeedsYou = {
  taskId: string;
  title: string;
  why: NeedsYouWhy;
  /** The card's own words, or the note on the task. Empty when there is nothing to add. */
  text: string;
  /** The Inbox card to answer, when there is one. */
  cardId: string | null;
  kind: string | null;
  botId: string | null;
  assigneeName: string | null;
};
export type ProjectTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  assignee: "bot" | "person";
  assigneeUserId: string | null;
  assigneeName: string | null;
  botId: string | null;
  /** The worker's note on where it is. Empty for a member who is not the owner. */
  progress: string;
  followUp: string;
  stepsDone: number;
  stepsTotal: number;
  updatedAt: Date;
  /** Whether the reader may open the task page (the owner, or the person it is assigned to). */
  canOpen: boolean;
  /** Whether the reader can write to whoever does the task: the owner, when a bot or another person does it. */
  canTell: boolean;
};
export type ProjectRoom = {
  id: string;
  title: string;
  status: string;
  progressPercent: number | null;
  progressNote: string;
};
/** An item of the project's memory, as the page lists it. */
export type ProjectNote = { slug: string; title: string; howto: string; updatedAt: Date };
/** Items of the project's memory shown on its page; the Memory page lists them all. */
const NOTES_SHOWN = 6;
export type ProjectDetail = ProjectSummary & {
  /** Open work, newest change first. */
  tasks: ProjectTask[];
  /** What was finished in the last seven days. */
  shipped: ProjectTask[];
  needsYou: NeedsYou[];
  rooms: ProjectRoom[];
  /** The newest items of the project's memory, and how many there are. Empty for a member: the memory is the owner's. */
  memory: { items: ProjectNote[]; total: number };
};

const emptyCounts = (): ProjectCounts => ({
  ...(Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>),
  total: 0,
});

export function createProjectStore(db: Database) {
  const people = createTeamPeople(db);
  /** Projects the user is a live person of: still in the team through which they were added. */
  const asPerson = (userId: string) =>
    db
      .select({ id: projectMember.projectId })
      .from(projectMember)
      .where(
        and(
          eq(projectMember.kind, "person"),
          eq(projectMember.userId, userId),
          inArray(projectMember.teamId, people.teamIds(userId)),
        ),
      );
  const visible = (a: ActiveActor) =>
    or(eq(project.ownerUserId, a.userId), inArray(project.id, asPerson(a.userId)))!;
  const mine = (a: ActiveActor, id: string) =>
    and(eq(project.id, id), eq(project.ownerUserId, a.userId));

  async function owned(a: ActiveActor, id: string) {
    const [row] = await db.select().from(project).where(mine(a, id));
    if (row) return row;
    // A member who reads the project is told they may not change it; a stranger learns nothing.
    const [seen] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, id), visible(a)));
    throw new AccessError(seen ? "ACCESS_DENIED" : "NOT_FOUND");
  }
  async function nameFree(a: ActiveActor, name: string, except?: string) {
    const [taken] = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(
          eq(project.ownerUserId, a.userId),
          sql`lower(${project.name}) = lower(${name})`,
          ne(project.status, "archived"),
          except ? ne(project.id, except) : undefined,
        ),
      );
    if (taken)
      throw new ProjectRuleError("NAME_TAKEN", "You already have a project with this name.");
  }
  /** Checks the lists against what the owner may pick and returns the rows to store. */
  async function resolveMembers(a: ActiveActor, v: ProjectMembers) {
    const botIds = [...new Set(v.bots)],
      userIds = [...new Set(v.people)];
    if (botIds.length > MAX_PROJECT_BOTS || userIds.length > MAX_PROJECT_PEOPLE)
      throw new ProjectRuleError("TOO_MANY", "A project has at most 30 bots and 30 people.");
    const bots = botIds.length
      ? await db
          .select({ id: bot.id })
          .from(bot)
          .where(
            and(eq(bot.ownerUserId, a.userId), eq(bot.archived, false), inArray(bot.id, botIds)),
          )
      : [];
    if (bots.length !== botIds.length)
      throw new ProjectRuleError("BAD_MEMBER", "One of these bots is not yours or is archived.");
    const teams = new Map((await people.ofOwner(a.userId)).map((p) => [p.userId, p.teamId]));
    if (userIds.some((id) => !teams.has(id)))
      throw new ProjectRuleError(
        "BAD_MEMBER",
        "One of these people is not in a team of yours. Add them to a team first.",
      );
    return {
      bots: botIds,
      people: userIds.map((userId) => ({ userId, teamId: teams.get(userId)! })),
    };
  }
  async function writeMembers(
    tx: Pick<Database, "delete" | "insert">,
    projectId: string,
    m: Awaited<ReturnType<typeof resolveMembers>>,
  ) {
    await tx.delete(projectMember).where(eq(projectMember.projectId, projectId));
    const rows = [
      ...m.bots.map((botId) => ({ projectId, kind: "bot" as const, botId })),
      ...m.people.map((p) => ({ projectId, kind: "person" as const, ...p })),
    ];
    if (rows.length) await tx.insert(projectMember).values(rows);
  }

  /** The members, the counts and the health of each project, as this reader may see them. */
  async function summarize(a: ActiveActor, rows: ProjectRow[], now = new Date()) {
    if (!rows.length) return { summaries: [] as ProjectSummary[], tasks: [], cards: [] };
    const ids = rows.map((r) => r.id);
    const [bots, persons, tasks] = await Promise.all([
      db
        .select({ projectId: projectMember.projectId, id: bot.id, name: bot.name })
        .from(projectMember)
        .innerJoin(bot, eq(bot.id, projectMember.botId))
        .where(
          and(
            inArray(projectMember.projectId, ids),
            eq(projectMember.kind, "bot"),
            eq(bot.archived, false),
          ),
        )
        .orderBy(asc(bot.name), asc(bot.id)),
      db
        .select({ projectId: projectMember.projectId, userId: user.id, name: user.name })
        .from(projectMember)
        .innerJoin(user, eq(user.id, projectMember.userId))
        .innerJoin(
          teamPerson,
          and(
            eq(teamPerson.teamId, projectMember.teamId),
            eq(teamPerson.userId, projectMember.userId),
          ),
        )
        .innerJoin(membership, eq(membership.userId, projectMember.userId))
        .where(
          and(
            inArray(projectMember.projectId, ids),
            eq(projectMember.kind, "person"),
            eq(membership.status, "active"),
            eq(membership.activationRevision, teamPerson.activationRevision),
          ),
        )
        .orderBy(asc(user.name), asc(user.id)),
      db
        .select({
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          assigneeUserId: task.assigneeUserId,
          assigneeName: user.name,
          botId: task.botId,
          progress: task.progress,
          followUp: task.followUp,
          updatedAt: task.updatedAt,
        })
        .from(task)
        .leftJoin(user, eq(user.id, task.assigneeUserId))
        .where(and(inArray(task.projectId, ids), isNull(task.parentTaskId)))
        .orderBy(desc(task.updatedAt)),
    ]);
    const ownedIds = new Set(rows.filter((r) => r.ownerUserId === a.userId).map((r) => r.id));
    const ownTasks = tasks.filter((t) => ownedIds.has(t.projectId!));
    // Cards are the reader's own: only the owner of a project is told what waits on them there.
    const cards = ownTasks.length
      ? await db
          .select({
            id: attentionItem.id,
            kind: attentionItem.kind,
            subjectId: attentionItem.subjectId,
            title: attentionItem.title,
            detail: attentionItem.detail,
          })
          .from(attentionItem)
          .where(
            and(
              eq(attentionItem.ownerUserId, a.userId),
              eq(attentionItem.status, "open"),
              inArray(attentionItem.kind, [...QUEUE_KINDS]),
              inArray(
                attentionItem.subjectId,
                ownTasks.map((t) => t.id),
              ),
            ),
          )
          .orderBy(desc(attentionItem.updatedAt))
      : [];
    const carded = new Set(cards.map((c) => c.subjectId));
    const summaries = rows.map((row): ProjectSummary => {
      const own = ownedIds.has(row.id);
      const mineTasks = tasks.filter((t) => t.projectId === row.id);
      const counts = emptyCounts();
      for (const t of mineTasks) {
        counts[t.status] += 1;
        counts.total += 1;
      }
      const needsYou = own
        ? mineTasks.filter(
            (t) => carded.has(t.id) || t.status === "blocked" || t.status === "review",
          ).length
        : 0;
      return {
        ...row,
        role: own ? "owner" : "member",
        bots: bots.filter((b) => b.projectId === row.id).map(({ id, name }) => ({ id, name })),
        people: persons
          .filter((p) => p.projectId === row.id)
          .map(({ userId, name }) => ({ userId, name })),
        counts,
        health: projectHealth({
          status: row.status,
          total: counts.total,
          done: counts.done,
          inProgress: counts.in_progress,
          needsYou,
          lastChange: mineTasks[0]?.updatedAt ?? null,
          now,
        }),
      };
    });
    return { summaries, tasks, cards };
  }

  const store = {
    /** Set by the services: the people whose project pages changed, for the live channel. */
    onChange: undefined as ((userIds: string[]) => void) | undefined,
    async list(a: ActiveActor): Promise<ProjectSummary[]> {
      const rows = await db
        .select()
        .from(project)
        .where(visible(a))
        .orderBy(desc(project.updatedAt));
      return (await summarize(a, rows)).summaries;
    },
    /** The owner's work that is in no project, so the list never hides it. */
    async unfiled(a: ActiveActor) {
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          open: sql<number>`count(*) filter (where ${task.status} <> 'done')::int`,
        })
        .from(task)
        .where(
          and(eq(task.ownerUserId, a.userId), isNull(task.projectId), isNull(task.parentTaskId)),
        );
      return { total: row?.total ?? 0, open: row?.open ?? 0 };
    },
    async get(a: ActiveActor, id: string, now = new Date()): Promise<ProjectDetail> {
      const [row] = await db
        .select()
        .from(project)
        .where(and(eq(project.id, id), visible(a)));
      if (!row) throw new AccessError("NOT_FOUND");
      const { summaries, tasks, cards } = await summarize(a, [row], now);
      const summary = summaries[0]!;
      const own = summary.role === "owner";
      const steps = tasks.length
        ? await db
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
            .groupBy(task.parentTaskId)
        : [];
      const stepsOf = new Map(steps.map((s) => [s.parentId, s]));
      const view = tasks.map(({ projectId: _p, ...t }): ProjectTask => ({
        ...t,
        progress: own ? t.progress : "",
        followUp: own ? t.followUp : "off",
        stepsDone: stepsOf.get(t.id)?.done ?? 0,
        stepsTotal: stepsOf.get(t.id)?.total ?? 0,
        canOpen: own || t.assigneeUserId === a.userId,
        canTell:
          own &&
          t.status !== "done" &&
          (t.assignee === "person" ? t.assigneeUserId !== a.userId : t.botId !== null),
      }));
      const cardOf = new Map<string, (typeof cards)[number]>();
      for (const c of cards)
        if (c.subjectId && !cardOf.has(c.subjectId)) cardOf.set(c.subjectId, c);
      const needsYou = own
        ? view.flatMap((t): NeedsYou[] => {
            const card = cardOf.get(t.id);
            const why: NeedsYouWhy | undefined = card
              ? "card"
              : t.status === "blocked"
                ? "blocked"
                : t.status === "review"
                  ? "review"
                  : undefined;
            if (!why) return [];
            return [
              {
                taskId: t.id,
                title: t.title,
                why,
                text: card ? card.detail || card.title : t.progress,
                cardId: card?.id ?? null,
                kind: card?.kind ?? null,
                botId: t.botId,
                assigneeName: t.assigneeName,
              },
            ];
          })
        : [];
      const rooms = own
        ? await db
            .select({
              id: discussion.id,
              title: discussion.title,
              status: discussion.status,
              progressPercent: discussion.progressPercent,
              progressNote: discussion.progressNote,
            })
            .from(discussion)
            .where(and(eq(discussion.projectId, id), eq(discussion.ownerUserId, a.userId)))
            .orderBy(desc(discussion.updatedAt))
        : [];
      const inMemory = and(
        eq(memoryItemProject.projectId, id),
        eq(memoryItem.ownerUserId, a.userId),
        ne(memoryItem.status, "archived"),
      );
      const notes = own
        ? await db
            .select({
              slug: memoryItem.slug,
              title: memoryItem.title,
              howto: memoryItem.howto,
              updatedAt: memoryItem.updatedAt,
            })
            .from(memoryItemProject)
            .innerJoin(memoryItem, eq(memoryItem.id, memoryItemProject.pageId))
            .where(inMemory)
            .orderBy(desc(memoryItem.updatedAt))
            .limit(NOTES_SHOWN)
        : [];
      const [noteCount] = own
        ? await db
            .select({ n: sql<number>`count(*)::int` })
            .from(memoryItemProject)
            .innerJoin(memoryItem, eq(memoryItem.id, memoryItemProject.pageId))
            .where(inMemory)
        : [];
      const since = +now - SHIPPED_MS;
      return {
        ...summary,
        tasks: view.filter((t) => t.status !== "done"),
        shipped: view.filter((t) => t.status === "done" && +t.updatedAt >= since),
        needsYou,
        rooms,
        memory: { items: notes, total: noteCount?.n ?? 0 },
      };
    },
    /** What the owner can put on a project: their bots, the people of their teams and their rooms. */
    async candidates(a: ActiveActor) {
      const [bots, persons, rooms] = await Promise.all([
        db
          .select({ id: bot.id, name: bot.name })
          .from(bot)
          .where(and(eq(bot.ownerUserId, a.userId), eq(bot.archived, false)))
          .orderBy(asc(bot.name), asc(bot.id)),
        people.ofOwner(a.userId),
        db
          .select({ id: discussion.id, title: discussion.title, projectId: discussion.projectId })
          .from(discussion)
          .where(
            and(
              eq(discussion.ownerUserId, a.userId),
              eq(discussion.kind, "room"),
              inArray(discussion.status, ["open", "paused", "stalled"]),
            ),
          )
          .orderBy(desc(discussion.updatedAt))
          .limit(200),
      ]);
      return { bots, people: persons.map(({ userId, name }) => ({ userId, name })), rooms };
    },
    async create(a: ActiveActor, v: ProjectFields & { name: string } & Partial<ProjectMembers>) {
      const { bots = [], people: persons = [], ...fields } = v;
      await nameFree(a, fields.name);
      const members = await resolveMembers(a, { bots, people: persons });
      const row = await db.transaction(async (tx) => {
        const [made] = await tx
          .insert(project)
          .values({ ownerUserId: a.userId, ...fields })
          .returning();
        await writeMembers(tx, made!.id, members);
        return made!;
      });
      changed(row.ownerUserId, members.people);
      return store.get(a, row.id);
    },
    async update(a: ActiveActor, id: string, v: ProjectFields) {
      const current = await owned(a, id);
      if (v.name !== undefined && v.name.toLowerCase() !== current.name.toLowerCase())
        await nameFree(a, v.name, id);
      // Bringing an archived project back must not collide with a newer project of the same name.
      if (current.status === "archived" && v.status && v.status !== "archived")
        await nameFree(a, v.name ?? current.name, id);
      await db
        .update(project)
        .set({ ...v, updatedAt: new Date() })
        .where(mine(a, id));
      await announce(id);
      return store.get(a, id);
    },
    async setMembers(a: ActiveActor, id: string, v: ProjectMembers) {
      await owned(a, id);
      const before = await personIds(id);
      const members = await resolveMembers(a, v);
      await db.transaction(async (tx) => {
        await writeMembers(tx, id, members);
        await tx.update(project).set({ updatedAt: new Date() }).where(eq(project.id, id));
      });
      changed(a.userId, [...before, ...members.people]);
      return store.get(a, id);
    },
    /** The rooms that work for this project: exactly this list. A room belongs to one project at a time. */
    async setRooms(a: ActiveActor, id: string, roomIds: string[]) {
      await owned(a, id);
      const wanted = [...new Set(roomIds)];
      if (wanted.length > MAX_PROJECT_ROOMS)
        throw new ProjectRuleError("TOO_MANY", "A project has at most 30 rooms.");
      const rooms = wanted.length
        ? await db
            .select({ id: discussion.id })
            .from(discussion)
            .where(
              and(
                eq(discussion.ownerUserId, a.userId),
                eq(discussion.kind, "room"),
                inArray(discussion.id, wanted),
              ),
            )
        : [];
      if (rooms.length !== wanted.length)
        throw new ProjectRuleError("BAD_ROOM", "One of these rooms is not yours.");
      await db.transaction(async (tx) => {
        await tx
          .update(discussion)
          .set({ projectId: null })
          .where(
            and(
              eq(discussion.projectId, id),
              wanted.length ? notInArray(discussion.id, wanted) : undefined,
            ),
          );
        if (wanted.length)
          await tx.update(discussion).set({ projectId: id }).where(inArray(discussion.id, wanted));
        await tx.update(project).set({ updatedAt: new Date() }).where(eq(project.id, id));
      });
      await announce(id);
      return store.get(a, id);
    },
  };
  const personIds = async (projectId: string) =>
    db
      .select({ userId: projectMember.userId })
      .from(projectMember)
      .where(and(eq(projectMember.projectId, projectId), eq(projectMember.kind, "person")));
  async function announce(projectId: string) {
    const [row] = await db
      .select({ ownerUserId: project.ownerUserId })
      .from(project)
      .where(eq(project.id, projectId));
    if (row) changed(row.ownerUserId, await personIds(projectId));
  }
  function changed(ownerUserId: string, persons: { userId: string | null }[]) {
    try {
      store.onChange?.([
        ...new Set([ownerUserId, ...persons.flatMap((p) => (p.userId ? [p.userId] : []))]),
      ]);
    } catch {
      // The write already happened: refreshing the pages is best effort.
    }
  }
  return store;
}
export type ProjectStore = ReturnType<typeof createProjectStore>;

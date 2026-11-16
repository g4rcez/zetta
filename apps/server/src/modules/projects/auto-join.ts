import type { Database } from "@zetta/db";
import { and, desc, eq } from "@zetta/db/query";
import { discussion } from "@zetta/db/schema/discussions";
import { project, projectMember } from "@zetta/db/schema/projects";

/**
 * The project a new task belongs to when nobody said: the project of the room it was made in, else the one active project its bot works
 * on. A bot on two projects, or on none, gives no answer and the task stays outside every project until the owner files it.
 */
export async function projectForTask(
  db: Pick<Database, "select">,
  ownerUserId: string,
  origin: { botId?: string | null; conversationId?: string | null },
): Promise<string | null> {
  if (origin.conversationId) {
    const [room] = await db
      .select({ id: project.id })
      .from(discussion)
      .innerJoin(project, eq(project.id, discussion.projectId))
      .where(
        and(
          eq(discussion.conversationId, origin.conversationId),
          eq(project.ownerUserId, ownerUserId),
          eq(project.status, "active"),
        ),
      );
    if (room) return room.id;
  }
  if (!origin.botId) return null;
  const rows = await db
    .select({ id: project.id })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(
      and(
        eq(projectMember.kind, "bot"),
        eq(projectMember.botId, origin.botId),
        eq(project.ownerUserId, ownerUserId),
        eq(project.status, "active"),
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}

/** The owner's own project, or undefined. Used before a task is filed under it. */
export async function ownedProject(
  db: Pick<Database, "select">,
  ownerUserId: string,
  projectId: string,
) {
  const [row] = await db
    .select({ id: project.id, status: project.status })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerUserId, ownerUserId)));
  return row;
}

/** The active projects a bot is on, newest first, with their briefs: what goes into the bot's context. */
export function activeProjectsOf(
  db: Pick<Database, "select">,
  ownerUserId: string,
  botId: string,
  limit = MAX_CONTEXT_PROJECTS,
) {
  return db
    .select({
      id: project.id,
      name: project.name,
      outcome: project.outcome,
      audience: project.audience,
      doneWhen: project.doneWhen,
      notIncluded: project.notIncluded,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(
      and(
        eq(projectMember.kind, "bot"),
        eq(projectMember.botId, botId),
        eq(project.ownerUserId, ownerUserId),
        eq(project.status, "active"),
      ),
    )
    .orderBy(desc(project.updatedAt))
    .limit(limit);
}
/** The most projects whose brief one bot carries in its context. */
export const MAX_CONTEXT_PROJECTS = 3;

/**
 * Where a bot's project memory goes. `projectId`: the project of the room it works in, when the bot is on that project (a new item with no
 * type is filed there). `onlyProjectId`: the one active project it is on, which is what `"type":"project"` means when it names none.
 */
export async function memoryProjectsOf(
  db: Pick<Database, "select">,
  ownerUserId: string,
  botId: string,
  discussionId?: string | null,
): Promise<{ projectId: string | null; onlyProjectId: string | null }> {
  const on = await activeProjectsOf(db, ownerUserId, botId, 50);
  const onlyProjectId = on.length === 1 ? on[0]!.id : null;
  if (!discussionId) return { projectId: null, onlyProjectId };
  const [room] = await db
    .select({ projectId: discussion.projectId })
    .from(discussion)
    .where(and(eq(discussion.id, discussionId), eq(discussion.ownerUserId, ownerUserId)));
  const mine = room?.projectId && on.some((p) => p.id === room.projectId);
  return { projectId: mine ? room.projectId : null, onlyProjectId };
}

import { ancestorsOf } from "@zetta/core/org";
import type { WorkCardKind, WorkWorker } from "@zetta/core/work-suggestions";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { membership } from "@zetta/db/schema/identity";
import { projectMember } from "@zetta/db/schema/projects";
import { team, teamPerson } from "@zetta/db/schema/teams";
import { readOrg } from "./store";

/** The admin wrote these names: one line, no fences, a limit. */
const line = (t: string, max = 80) =>
  t.replaceAll("```", "'''").replace(/\s+/g, " ").trim().slice(0, max);

export type ChartManager = { userId: string; name: string; title: string };

/**
 * The person the company chart puts nearest above whoever does a task, when that is somebody other than the task's owner. Seats nobody
 * holds, and bots, are skipped: only a person can be told. Undefined when the chart says nothing more, or the owner is that person.
 */
export async function chartManager(
  db: Pick<Database, "select">,
  f: { ownerUserId: string; worker: WorkWorker | null },
): Promise<ChartManager | undefined> {
  const worker = f.worker;
  if (!worker) return undefined;
  const { positions } = await readOrg(db, f.ownerUserId);
  const seat = positions.find((p) =>
    worker.kind === "bot"
      ? p.holder?.kind === "bot" && p.holder.botId === worker.id
      : p.holder?.kind === "person" && p.holder.userId === worker.id,
  );
  if (!seat) return undefined;
  const above = ancestorsOf(positions, seat.id).find((p) => p.holder?.kind === "person");
  const who = above?.holder;
  if (!above || who?.kind !== "person" || who.userId === f.ownerUserId) return undefined;
  return { userId: who.userId, name: who.name, title: above.title };
}

/**
 * Whether a person other than the owner may read a task: only through its project, as a person of one of the owner's teams who is still
 * there (the same rule the project page uses). The chart decides who should hear; this decides what they may see.
 */
export async function canReadTask(
  db: Pick<Database, "select">,
  task: { ownerUserId: string; projectId: string | null },
  userId: string,
): Promise<boolean> {
  if (userId === task.ownerUserId) return true;
  if (!task.projectId) return false;
  const rows = await db
    .select({ id: projectMember.id })
    .from(projectMember)
    .innerJoin(
      teamPerson,
      and(eq(teamPerson.teamId, projectMember.teamId), eq(teamPerson.userId, projectMember.userId)),
    )
    .innerJoin(team, eq(team.id, teamPerson.teamId))
    .innerJoin(membership, eq(membership.userId, teamPerson.userId))
    .where(
      and(
        eq(projectMember.projectId, task.projectId),
        eq(projectMember.kind, "person"),
        eq(projectMember.userId, userId),
        eq(team.ownerUserId, task.ownerUserId),
        eq(team.status, "active"),
        eq(membership.status, "active"),
        eq(membership.activationRevision, teamPerson.activationRevision),
      ),
    );
  return rows.length > 0;
}

/**
 * A line for the owner's card of a task that stopped, when the company chart puts somebody else over whoever does it. The card stays with
 * the owner, because only the owner can act on a task (every button checks it); the other person gets a read-only heads-up.
 */
export const chartNote = (m: ChartManager | undefined, workerName: string): string =>
  m
    ? `In the company chart, ${line(workerName)} reports to ${line(m.name)} (${line(m.title)}). The task is yours, so this card is yours; ${line(m.name)} got a heads-up.`
    : "";

const VERB: Partial<Record<WorkCardKind, string>> = {
  work_stuck: "stopped on",
  work_blocked: "is blocked on",
  work_drift: "is going a different way on",
};

/**
 * What the chart manager reads: that somebody under them needs attention and who decides. The task's title is shown only when they could
 * already read the task; otherwise only the fact is, so the chart never opens up a private task.
 */
export function headsUpText(
  kind: WorkCardKind,
  v: { workerName: string; ownerName: string; taskTitle: string; detail: string; canRead: boolean },
): { title: string; detail: string } {
  const verb = VERB[kind] ?? "needs attention on";
  const worker = line(v.workerName);
  const owner = line(v.ownerName);
  return v.canRead
    ? {
        title: `${worker} ${verb} “${line(v.taskTitle)}”`.slice(0, 160),
        detail: `${v.detail} This is ${owner}'s task, so ${owner} decides what to do. You hear about it because the company chart puts ${worker} under you.`,
      }
    : {
        title: `${worker} ${verb} a task from ${owner}`.slice(0, 160),
        detail: `You hear about it because the company chart puts ${worker} under you. The task is ${owner}'s, so ${owner} decides what to do; ask them if you want to help.`,
      };
}

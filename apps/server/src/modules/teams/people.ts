import type { Database } from "@zetta/db";
import { and, asc, eq, ne, notInArray, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { team, teamPerson } from "@zetta/db/schema/teams";
import { createPeopleDirectory, type PersonLine } from "../people/directory";

/**
 * A person counts while the installation membership is active under the same revision they joined with. A removed member loses the
 * team at once, and enrolling again (a new revision) does not bring the old row back: the team owner has to add them again.
 */
const live = and(
  eq(membership.status, "active"),
  eq(membership.activationRevision, teamPerson.activationRevision),
);

/** A person of a team. `title` is their job title, else the title of their seat in the company chart (empty when neither is written). */
export type TeamPersonView = {
  userId: string;
  name: string;
  role: "owner" | "member";
} & PersonLine;

const NO_LINE: PersonLine = { avatar: null, title: "" };

export function createTeamPeople(db: Pick<Database, "select" | "insert" | "delete">) {
  const directory = createPeopleDirectory(db);
  /** Adds the picture and title to rows that carry a `userId`. */
  async function withLines<T extends { userId: string }>(rows: T[]): Promise<(T & PersonLine)[]> {
    const lines = await directory.lines(rows.map((r) => r.userId));
    return rows.map((r) => ({ ...r, ...(lines.get(r.userId) ?? NO_LINE) }));
  }
  /** Ids of the teams the user belongs to (owner or member). Use it as a subquery: `inArray(discussion.teamId, people.teamIds(id))`. */
  const teamIds = (userId: string) =>
    db
      .select({ id: teamPerson.teamId })
      .from(teamPerson)
      .innerJoin(membership, eq(membership.userId, teamPerson.userId))
      .where(and(eq(teamPerson.userId, userId), live));

  return {
    teamIds,
    async isPerson(userId: string, teamId: string) {
      const rows = await teamIds(userId);
      return rows.some((r) => r.id === teamId);
    },
    /** The people of a team, owner first. Without pictures and titles: it is on the path of every live update of a team room. */
    async list(teamId: string) {
      return db
        .select({ userId: teamPerson.userId, name: user.name, role: teamPerson.role })
        .from(teamPerson)
        .innerJoin(membership, eq(membership.userId, teamPerson.userId))
        .innerJoin(user, eq(user.id, teamPerson.userId))
        .where(and(eq(teamPerson.teamId, teamId), live))
        .orderBy(sql`${teamPerson.role} = 'owner' desc`, asc(user.name), asc(teamPerson.userId));
    },
    /** `list` with each person's picture and title, for what a person or a bot reads. */
    async listWithLines(teamId: string): Promise<TeamPersonView[]> {
      return withLines(await this.list(teamId));
    },
    /**
     * The people of every active team this user owns, without the owner: who they can hand work to. One row per person, with the oldest
     * team that holds them (the team through which they see that work).
     */
    async ofOwner(
      ownerUserId: string,
    ): Promise<{ userId: string; name: string; teamId: string }[]> {
      const rows = await db
        .select({ userId: teamPerson.userId, name: user.name, teamId: teamPerson.teamId })
        .from(teamPerson)
        .innerJoin(team, eq(team.id, teamPerson.teamId))
        .innerJoin(membership, eq(membership.userId, teamPerson.userId))
        .innerJoin(user, eq(user.id, teamPerson.userId))
        .where(
          and(
            eq(team.ownerUserId, ownerUserId),
            eq(team.status, "active"),
            ne(teamPerson.userId, ownerUserId),
            live,
          ),
        )
        .orderBy(asc(user.name), asc(teamPerson.userId), asc(team.createdAt), asc(team.id));
      const seen = new Set<string>();
      return rows.filter((r) => !seen.has(r.userId) && seen.add(r.userId));
    },
    /** `ofOwner` with each person's picture and title, for the project member picker. */
    async ofOwnerWithLines(ownerUserId: string) {
      return withLines(await this.ofOwner(ownerUserId));
    },
    /** Active installation members who are not in the team yet. Name, picture and title: no email. */
    async candidates(teamId: string) {
      const inTeam = db
        .select({ id: teamPerson.userId })
        .from(teamPerson)
        .innerJoin(membership, eq(membership.userId, teamPerson.userId))
        .where(and(eq(teamPerson.teamId, teamId), live));
      const rows = await db
        .select({ userId: user.id, name: user.name })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(and(eq(membership.status, "active"), notInArray(user.id, inTeam)))
        .orderBy(asc(user.name), asc(user.id));
      return withLines(rows);
    },
    /** The revision of the user's active membership, or undefined when they are not an active member. */
    async activeRevision(userId: string) {
      const [row] = await db
        .select({ revision: membership.activationRevision })
        .from(membership)
        .where(and(eq(membership.userId, userId), eq(membership.status, "active")));
      return row?.revision;
    },
    /** Adds or refreshes a member. An owner row is never changed. Returns false when the user is not an active installation member. */
    async add(teamId: string, userId: string) {
      const revision = await this.activeRevision(userId);
      if (revision === undefined) return false;
      await db
        .insert(teamPerson)
        .values({ teamId, userId, role: "member", activationRevision: revision })
        .onConflictDoUpdate({
          target: [teamPerson.teamId, teamPerson.userId],
          set: { activationRevision: revision, joinedAt: new Date() },
          setWhere: eq(teamPerson.role, "member"),
        });
      return true;
    },
    /** Removes a member. Returns false when the user is the owner or not in the team. */
    async remove(teamId: string, userId: string) {
      const rows = await db
        .delete(teamPerson)
        .where(
          and(
            eq(teamPerson.teamId, teamId),
            eq(teamPerson.userId, userId),
            eq(teamPerson.role, "member"),
          ),
        )
        .returning({ userId: teamPerson.userId });
      return rows.length > 0;
    },
  };
}
export type TeamPeople = ReturnType<typeof createTeamPeople>;

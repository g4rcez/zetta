import type { Database } from "@zetta/db";
import { and, asc, eq, notInArray, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { teamPerson } from "@zetta/db/schema/teams";

/**
 * A person counts while the installation membership is active under the same revision they joined with. A removed member loses the
 * team at once, and enrolling again (a new revision) does not bring the old row back: the team owner has to add them again.
 */
const live = and(
  eq(membership.status, "active"),
  eq(membership.activationRevision, teamPerson.activationRevision),
);

export type TeamPersonView = { userId: string; name: string; role: "owner" | "member" };

export function createTeamPeople(db: Pick<Database, "select" | "insert" | "delete">) {
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
    async list(teamId: string): Promise<TeamPersonView[]> {
      return db
        .select({ userId: teamPerson.userId, name: user.name, role: teamPerson.role })
        .from(teamPerson)
        .innerJoin(membership, eq(membership.userId, teamPerson.userId))
        .innerJoin(user, eq(user.id, teamPerson.userId))
        .where(and(eq(teamPerson.teamId, teamId), live))
        .orderBy(sql`${teamPerson.role} = 'owner' desc`, asc(user.name), asc(teamPerson.userId));
    },
    /** Active installation members who are not in the team yet. Name only: no email. */
    async candidates(teamId: string) {
      const inTeam = db
        .select({ id: teamPerson.userId })
        .from(teamPerson)
        .innerJoin(membership, eq(membership.userId, teamPerson.userId))
        .where(and(eq(teamPerson.teamId, teamId), live));
      return db
        .select({ userId: user.id, name: user.name })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(and(eq(membership.status, "active"), notInArray(user.id, inTeam)))
        .orderBy(asc(user.name), asc(user.id));
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

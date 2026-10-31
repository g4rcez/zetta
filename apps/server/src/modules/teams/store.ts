import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, or, sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { discussion } from "@zetta/db/schema/discussions";
import {
  team,
  teamMember,
  teamRole,
  type TeamBox,
  type TeamKind,
  type TeamPoint,
  type TeamRoleColor,
  type TeamRoleIcon,
} from "@zetta/db/schema/teams";
import { requireOwned, type ActiveActor } from "../identity/access";
import type { DiscussionStore } from "../discussions/store";

/**
 * Teams: named groups of bots with one chief. A room is a discussion opened for a team: the chief is its facilitator, so the user's
 * prompts reach the chief first and the chief coordinates the rest (discussions/prompt.ts wakeTargets + CHIEF_TOOLS).
 */
export class TeamError extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND" | "STALE_VERSION" | "NAME_TAKEN",
    readonly safe: string,
  ) {
    super(code);
  }
}

export type TeamMemberInput = {
  botId: string;
  kind: TeamKind;
  roleId: string | null;
  canvas: TeamPoint;
};
export type TeamRoleInput = {
  name: string;
  description: string;
  color: TeamRoleColor;
  icon: TeamRoleIcon;
};

/** The roles every user starts with (the migration seeds the same list for existing users). */
const DEFAULT_ROLES: TeamRoleInput[] = [
  {
    name: "Researcher",
    description: "Finds and checks sources",
    color: "blue",
    icon: "magnifying-glass",
  },
  { name: "Developer", description: "Writes and changes code", color: "green", icon: "code" },
  { name: "Writer", description: "Drafts and edits text", color: "violet", icon: "pencil" },
  {
    name: "Reviewer",
    description: "Checks the work of others",
    color: "amber",
    icon: "check-circle",
  },
  { name: "Designer", description: "Shapes the look and the flow", color: "pink", icon: "palette" },
  {
    name: "Analyst",
    description: "Reads data and reports findings",
    color: "teal",
    icon: "chart-bar",
  },
  { name: "Tester", description: "Looks for bugs and regressions", color: "red", icon: "bug" },
  { name: "Planner", description: "Splits goals into steps", color: "orange", icon: "compass" },
];
export type TeamInput = { name: string; goal: string; canvas: TeamBox; members: TeamMemberInput[] };

const isUnique = (e: unknown) =>
  [e, (e as { cause?: unknown } | null)?.cause].some(
    (x) => (x as { code?: string } | null)?.code === "23505",
  );

export function createTeamStore(
  db: Database,
  discussions: Pick<DiscussionStore, "open" | "postAsOwner">,
) {
  const visible = (a: ActiveActor) => or(eq(bot.ownerUserId, a.userId), eq(bot.visibility, "team"));
  async function loadOwned(a: ActiveActor, id: string) {
    const [row] = await db
      .select()
      .from(team)
      .where(and(eq(team.id, id), eq(team.ownerUserId, a.userId), eq(team.status, "active")));
    return requireOwned(a, row);
  }
  async function membersOf(teamIds: string[]) {
    if (!teamIds.length) return [];
    return db
      .select({ m: teamMember, name: bot.name, role: teamRole })
      .from(teamMember)
      .innerJoin(bot, eq(bot.id, teamMember.botId))
      .leftJoin(teamRole, eq(teamRole.id, teamMember.roleId))
      .where(inArray(teamMember.teamId, teamIds))
      .orderBy(asc(teamMember.joinedAt));
  }
  const shape = (rows: Awaited<ReturnType<typeof membersOf>>, teamId: string) =>
    rows
      .filter((r) => r.m.teamId === teamId)
      .map((r) => ({
        botId: r.m.botId,
        name: r.name,
        kind: r.m.kind,
        roleId: r.m.roleId,
        /** The role's name, empty when the member has none. */
        role: r.role?.name ?? "",
        canvas: r.m.canvas,
      }));
  const listRoles = (a: ActiveActor) =>
    db.select().from(teamRole).where(eq(teamRole.ownerUserId, a.userId)).orderBy(asc(teamRole.id));
  /** Role text for a room member: the role's name and what it does. */
  const roleText = (r: { name: string; description: string } | null) =>
    r ? (r.description ? `${r.name}: ${r.description}` : r.name).slice(0, 200) : "";

  return {
    /** The user's roles. A user with none gets the suggested ones first. */
    async roles(a: ActiveActor) {
      const found = await listRoles(a);
      if (found.length) return found;
      await db
        .insert(teamRole)
        .values(DEFAULT_ROLES.map((r) => ({ ...r, ownerUserId: a.userId })))
        .onConflictDoNothing();
      return listRoles(a);
    },
    async createRole(a: ActiveActor, v: TeamRoleInput) {
      try {
        const [row] = await db
          .insert(teamRole)
          .values({ ...v, ownerUserId: a.userId })
          .returning();
        return row!;
      } catch (e) {
        if (isUnique(e))
          throw new TeamError("NAME_TAKEN", "You already have a role with this name.");
        throw e;
      }
    },
    async updateRole(a: ActiveActor, id: string, v: TeamRoleInput) {
      try {
        const [row] = await db
          .update(teamRole)
          .set({ ...v, updatedAt: new Date() })
          .where(and(eq(teamRole.id, id), eq(teamRole.ownerUserId, a.userId)))
          .returning();
        return requireOwned(a, row);
      } catch (e) {
        if (isUnique(e))
          throw new TeamError("NAME_TAKEN", "You already have a role with this name.");
        throw e;
      }
    },
    /** Members that had the role stay in their teams without one (foreign key `on delete set null`). */
    async deleteRole(a: ActiveActor, id: string) {
      const [row] = await db
        .delete(teamRole)
        .where(and(eq(teamRole.id, id), eq(teamRole.ownerUserId, a.userId)))
        .returning({ id: teamRole.id, ownerUserId: teamRole.ownerUserId });
      requireOwned(a, row);
    },
    async list(a: ActiveActor) {
      const teams = await db
        .select()
        .from(team)
        .where(and(eq(team.ownerUserId, a.userId), eq(team.status, "active")))
        .orderBy(asc(team.createdAt));
      const members = await membersOf(teams.map((t) => t.id));
      return teams.map((t) => ({ ...t, members: shape(members, t.id) }));
    },
    async get(a: ActiveActor, id: string) {
      const t = await loadOwned(a, id);
      return { ...t, members: shape(await membersOf([id]), id) };
    },
    async create(a: ActiveActor, v: { name: string; goal: string; canvas: TeamBox }) {
      try {
        const [row] = await db
          .insert(team)
          .values({ ownerUserId: a.userId, name: v.name, goal: v.goal, canvas: v.canvas })
          .returning();
        return { ...row!, members: [] };
      } catch (e) {
        if (isUnique(e)) throw new TeamError("INVALID", "You already have a team with this name.");
        throw e;
      }
    },
    /** Replaces name, goal, position and members in one step. A team with members has exactly one chief. */
    async save(a: ActiveActor, id: string, expectedVersion: number, v: TeamInput) {
      await loadOwned(a, id);
      const ids = v.members.map((m) => m.botId);
      if (new Set(ids).size !== ids.length)
        throw new TeamError("INVALID", "A bot can be in a team only once.");
      if (ids.length && v.members.filter((m) => m.kind === "chief").length !== 1)
        throw new TeamError("INVALID", "Pick exactly one chief for the team.");
      const roleIds = [...new Set(v.members.flatMap((m) => (m.roleId ? [m.roleId] : [])))];
      if (roleIds.length) {
        const ok = await db
          .select({ id: teamRole.id })
          .from(teamRole)
          .where(and(inArray(teamRole.id, roleIds), eq(teamRole.ownerUserId, a.userId)));
        if (ok.length !== roleIds.length)
          throw new TeamError("NOT_FOUND", "A role in this team is not available.");
      }
      if (ids.length) {
        const ok = await db
          .select({ id: bot.id })
          .from(bot)
          .where(and(inArray(bot.id, ids), visible(a), eq(bot.archived, false)));
        if (ok.length !== ids.length)
          throw new TeamError("NOT_FOUND", "A bot in this team is not available.");
      }
      try {
        await db.transaction(async (tx) => {
          const [row] = await tx
            .update(team)
            .set({
              name: v.name,
              goal: v.goal,
              canvas: v.canvas,
              version: sql`${team.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(team.id, id),
                eq(team.ownerUserId, a.userId),
                eq(team.version, expectedVersion),
              ),
            )
            .returning({ id: team.id });
          if (!row)
            throw new TeamError(
              "STALE_VERSION",
              "Someone changed this team. Reload it and apply your edits again.",
            );
          await tx.delete(teamMember).where(eq(teamMember.teamId, id));
          if (v.members.length)
            await tx.insert(teamMember).values(v.members.map((m) => ({ ...m, teamId: id })));
        });
      } catch (e) {
        if (isUnique(e)) throw new TeamError("INVALID", "You already have a team with this name.");
        throw e;
      }
      const [t] = await db.select().from(team).where(eq(team.id, id));
      return { ...t!, members: shape(await membersOf([id]), id) };
    },
    async archive(a: ActiveActor, id: string) {
      await loadOwned(a, id);
      await db
        .update(team)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(team.id, id));
    },
    /** Opens a room: the chief is the facilitator and only the chief wakes for the first order. */
    async startRoom(
      a: ActiveActor,
      id: string,
      v: { title: string; goal: string; firstMessage?: string },
    ) {
      const t = await loadOwned(a, id);
      const members = await membersOf([id]);
      const chief = members.find((m) => m.m.kind === "chief");
      if (!chief || members.length < 2)
        throw new TeamError(
          "INVALID",
          "A room needs a chief and at least one other bot in the team.",
        );
      const [chiefBot] = await db
        .select()
        .from(bot)
        .where(and(eq(bot.id, chief.m.botId), visible(a), eq(bot.archived, false)));
      if (!chiefBot) throw new TeamError("NOT_FOUND", "The chief of this team is not available.");
      const [taken] = await db
        .select({ id: discussion.id })
        .from(discussion)
        .where(
          and(
            eq(discussion.ownerUserId, a.userId),
            sql`${discussion.teamId} is not null`,
            sql`lower(${discussion.title}) = lower(${v.title})`,
          ),
        );
      if (taken)
        throw new TeamError(
          "NAME_TAKEN",
          "A room with this name already exists. Pick another name.",
        );
      // The unique index is the last guard: two requests with the same name can pass the check above together.
      const opened = await discussions
        .open(a, {
          title: v.title,
          goal: v.goal || t.goal,
          context: "",
          members: members
            .filter((m) => m !== chief)
            .map((m) => ({ bot: m.m.botId, role: roleText(m.role) })),
          firstMessage: `Room open for team ${t.name}. Waiting for the first order.`,
          createdBy: chiefBot,
          tainted: false,
          teamId: t.id,
          wake: false,
        })
        .catch((e) => {
          throw isUnique(e)
            ? new TeamError(
                "NAME_TAKEN",
                "A room with this name already exists. Pick another name.",
              )
            : e;
        });
      // Without a first order the chief stays asleep until the user writes.
      if (v.firstMessage) await discussions.postAsOwner(a, opened.discussion.id, v.firstMessage);
      return { discussionId: opened.discussion.id };
    },
    /** The team's chat: its newest live room, or a new one named after the team. Opening it does not wake the chief. */
    async openChat(a: ActiveActor, id: string) {
      const t = await loadOwned(a, id);
      const [live] = await db
        .select({ id: discussion.id })
        .from(discussion)
        .where(
          and(
            eq(discussion.teamId, t.id),
            eq(discussion.ownerUserId, a.userId),
            inArray(discussion.status, ["open", "paused", "stalled"]),
          ),
        )
        .orderBy(desc(discussion.updatedAt))
        .limit(1);
      if (live) return { discussionId: live.id };
      const name = t.name.slice(0, 100);
      // Room names stay unique even after a room closes, so a second chat gets a time suffix.
      return this.startRoom(a, id, { title: name, goal: "" }).catch((e) => {
        if (!(e instanceof TeamError) || e.code !== "NAME_TAKEN") throw e;
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        return this.startRoom(a, id, { title: `${name} ${stamp}`, goal: "" });
      });
    },
  };
}
export type TeamStore = ReturnType<typeof createTeamStore>;

import { refreshMentionLabels } from "../chat/mention-text";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, or, sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { discussion, discussionMember } from "@zetta/db/schema/discussions";
import {
  team,
  teamMember,
  teamPerson,
  teamRole,
  type TeamBox,
  type TeamKind,
  type TeamPoint,
  type TeamRoleColor,
  type TeamRoleIcon,
} from "@zetta/db/schema/teams";
import { requireOwned, requireTeamMember, type ActiveActor } from "../identity/access";
import { createTeamPeople } from "./people";
import { DiscussionError, type DiscussionStore } from "../discussions/store";
import { insertMessage } from "../chat/messages";
import { hasUniqueViolation } from "../pg-error";

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
export type TeamInput = {
  name: string;
  goal: string;
  /** Left out by callers that do not edit it (the Teams canvas), so a save never wipes it. */
  context?: string | undefined;
  canvas: TeamBox;
  members: TeamMemberInput[];
};

export function createTeamStore(
  db: Database,
  discussions: Pick<DiscussionStore, "open" | "postAsOwner">,
) {
  const visible = (a: ActiveActor) => or(eq(bot.ownerUserId, a.userId), eq(bot.visibility, "team"));
  const people = createTeamPeople(db);
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

  const api = {
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
        if (hasUniqueViolation(e))
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
        if (hasUniqueViolation(e))
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
        const revision = await people.activeRevision(a.userId);
        if (revision === undefined) throw new TeamError("NOT_FOUND", "Team not found.");
        const row = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(team)
            .values({ ownerUserId: a.userId, name: v.name, goal: v.goal, canvas: v.canvas })
            .returning();
          await tx.insert(teamPerson).values({
            teamId: created!.id,
            userId: a.userId,
            role: "owner",
            activationRevision: revision,
          });
          return created!;
        });
        return { ...row, members: [] };
      } catch (e) {
        if (hasUniqueViolation(e))
          throw new TeamError("INVALID", "You already have a team with this name.");
        throw e;
      }
    },
    /** Replaces name, goal, context (when given), position and members in one step. A team with members has exactly one chief. */
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
              ...(v.context !== undefined ? { context: v.context } : {}),
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
        if (hasUniqueViolation(e))
          throw new TeamError("INVALID", "You already have a team with this name.");
        throw e;
      }
      const [t] = await db.select().from(team).where(eq(team.id, id));
      await refreshMentionLabels(db, "team", id, t!.name);
      return { ...t!, members: shape(await membersOf([id]), id) };
    },
    /** The people of a team, for the owner and for every member. */
    async people(a: ActiveActor, id: string) {
      const [row] = await db
        .select()
        .from(team)
        .where(and(eq(team.id, id), eq(team.status, "active")));
      requireTeamMember(a, row, row ? await people.isPerson(a.userId, id) : false);
      return people.list(id);
    },
    /** Active installation members the owner can still add. */
    async candidates(a: ActiveActor, id: string) {
      await loadOwned(a, id);
      return people.candidates(id);
    },
    async addPerson(a: ActiveActor, id: string, userId: string) {
      await loadOwned(a, id);
      if (!(await people.add(id, userId)))
        throw new TeamError("NOT_FOUND", "That person is not a member of this installation.");
      return people.list(id);
    },
    async removePerson(a: ActiveActor, id: string, userId: string) {
      await loadOwned(a, id);
      if (!(await people.remove(id, userId)))
        throw new TeamError(
          "INVALID",
          "The owner stays in the team, and only a member can be removed.",
        );
      return people.list(id);
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
      v: { title: string; goal: string; context?: string; firstMessage?: string },
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
            inArray(discussion.status, ["open", "paused", "stalled"]),
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
          goal: v.goal,
          context: v.context ?? "",
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
          throw hasUniqueViolation(e)
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
    /**
     * Changes the type of a room after it was made. Into a team: the chief becomes the facilitator and the team's other bots join
     * (the bots already in the room stay). Out of a team: the room keeps its members and the user is the facilitator again.
     */
    async setRoomTeam(a: ActiveActor, roomId: string, teamId: string | null) {
      const [room] = await db
        .select()
        .from(discussion)
        .where(and(eq(discussion.id, roomId), eq(discussion.ownerUserId, a.userId)));
      const d = requireOwned(a, room);
      if (d.kind !== "room")
        throw new DiscussionError("NOT_ALLOWED", "Only a room can change its type.");
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `That room is ${d.status}.`);
      if ((d.teamId ?? null) === teamId) return d;
      let chiefBotId: string | null = null;
      let joining: { botId: string; role: string }[] = [];
      let note = "Room is no longer in a team.";
      if (teamId) {
        const t = await loadOwned(a, teamId);
        const members = await membersOf([teamId]);
        const chief = members.find((m) => m.m.kind === "chief");
        if (!chief || members.length < 2)
          throw new TeamError(
            "INVALID",
            "A room needs a chief and at least one other bot in the team.",
          );
        const usable = await db
          .select({ id: bot.id })
          .from(bot)
          .where(
            and(
              inArray(
                bot.id,
                members.map((m) => m.m.botId),
              ),
              visible(a),
              eq(bot.archived, false),
            ),
          );
        if (!usable.some((b) => b.id === chief.m.botId))
          throw new TeamError("NOT_FOUND", "The chief of this team is not available.");
        const ok = new Set(usable.map((b) => b.id));
        chiefBotId = chief.m.botId;
        joining = members
          .filter((m) => ok.has(m.m.botId))
          .map((m) => ({ botId: m.m.botId, role: roleText(m.role) }));
        note = `Room moved to team ${t.name}.`;
      }
      try {
        return await db.transaction(async (tx) => {
          const [row] = await tx
            .update(discussion)
            .set({
              teamId,
              createdByBotId: chiefBotId,
              version: sql`${discussion.version} + 1`,
              updatedAt: new Date(),
            })
            .where(and(eq(discussion.id, d.id), eq(discussion.version, d.version)))
            .returning();
          if (!row)
            throw new DiscussionError(
              "CONFLICT",
              "The room changed meanwhile. Reload it and try again.",
            );
          if (joining.length)
            await tx
              .insert(discussionMember)
              .values(joining.map((m) => ({ discussionId: d.id, ...m })))
              .onConflictDoNothing();
          await insertMessage(tx, d.conversationId, {
            ownerUserId: d.ownerUserId,
            role: "system",
            content: note,
            meta: { discussionEvent: "team" },
          });
          return row;
        });
      } catch (e) {
        if (hasUniqueViolation(e))
          throw new TeamError(
            "NAME_TAKEN",
            "A room with this name already exists. Pick another name.",
          );
        throw e;
      }
    },
    /**
     * The team's chat: its newest live room, else the room named after the team (a closed one is reopened), else a new one.
     * Room names are unique, so the chat never gets a second room with a time suffix. Opening it does not wake the chief.
     */
    async openChat(a: ActiveActor, id: string) {
      const t = await loadOwned(a, id);
      // The team's standing conversation: the same room every time, reopened when it was closed.
      if (t.homeDiscussionId) {
        const [home] = await db
          .select({ id: discussion.id, status: discussion.status })
          .from(discussion)
          .where(and(eq(discussion.id, t.homeDiscussionId), eq(discussion.ownerUserId, a.userId)));
        if (home && home.status !== "resolved" && home.status !== "cancelled")
          return { discussionId: home.id };
        if (home) {
          const [reopened] = await db
            .update(discussion)
            .set({
              status: "open",
              resolvedAt: null,
              updatedAt: new Date(),
              version: sql`${discussion.version} + 1`,
            })
            .where(eq(discussion.id, home.id))
            .returning({ id: discussion.id });
          if (reopened) return { discussionId: reopened.id };
        }
      }
      const found = await findChat(a, t);
      await db.update(team).set({ homeDiscussionId: found.discussionId }).where(eq(team.id, t.id));
      return found;
    },
  };
  return api;
  async function findChat(
    a: ActiveActor,
    t: typeof team.$inferSelect,
  ): Promise<{ discussionId: string }> {
    {
      const id = t.id;
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
      // Several closed rooms may share the name: only the newest one is reopened, so the active-name index holds.
      const [newest] = await db
        .select({ id: discussion.id })
        .from(discussion)
        .where(
          and(
            eq(discussion.teamId, t.id),
            eq(discussion.ownerUserId, a.userId),
            sql`lower(${discussion.title}) = lower(${name})`,
            inArray(discussion.status, ["resolved", "cancelled"]),
          ),
        )
        .orderBy(desc(discussion.updatedAt))
        .limit(1);
      if (newest) {
        const [closed] = await db
          .update(discussion)
          .set({
            status: "open",
            resolvedAt: null,
            updatedAt: new Date(),
            version: sql`${discussion.version} + 1`,
          })
          .where(
            and(
              eq(discussion.id, newest.id),
              inArray(discussion.status, ["resolved", "cancelled"]),
            ),
          )
          .returning({ id: discussion.id });
        if (closed) return { discussionId: closed.id };
      }
      return api.startRoom(a, id, { title: name, goal: "" });
    }
  }
}
export type TeamStore = ReturnType<typeof createTeamStore>;

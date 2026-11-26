// A workspace's own people: who is in it, with which role, and whose Chief is a bot someone shared with them. Joining and leaving a
// workspace happen in the identity operations (identity-hooks.ts); this is what its administrators change afterwards.
import {
  administers,
  isWorkspaceRole,
  refuseRoleChange,
  ROLE_CHANGE_REFUSALS,
  WORKSPACE_NAME_MAX,
  type WorkspaceRole,
} from "@zetta/core/workspace";
import { tenant, type Database } from "@zetta/db";
import { and, asc, desc, eq, gt, isNull, or, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { installationIdentity, invitation, membership } from "@zetta/db/schema/identity";
import {
  chiefShare,
  invitationGrant,
  workspace,
  workspaceMember,
} from "@zetta/db/schema/workspaces";
import type { AuditKind, AuditOutcome } from "../features/audit";
import { AccessError, type ActiveActor } from "../identity/access";
import type { PeopleDirectory } from "../people/directory";
import { createHash } from "node:crypto";
import { enrollmentHooks, firstWorkspaceId, placeIn, placeOf, rootPlace } from "./identity-hooks";

/** A slug a person may give a new workspace: what the address carries. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Sends an invitation, as the identity routes do (modules/identity/enrollment.ts). */
type Inviter = (
  actor: { userId: string },
  input: { intendedEmail: string; role: "admin" },
) => Promise<{ token: string; expiresAt: Date | string; invitationId: string }>;

export class WorkspaceError extends Error {
  constructor(
    readonly code: "NOT_ALLOWED" | "NOT_FOUND" | "INVALID",
    message: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Audit = (
  userId: string,
  event: { kind: AuditKind; outcome: AuditOutcome; subjectId: string; detail: string },
) => void;

export function createWorkspaceService(
  db: Database,
  deps: {
    audit?: Audit;
    /** The picture and the title of each person, for the list of members. */
    people?: Pick<PeopleDirectory, "lines">;
    /** Root's invitation to the owner of a new workspace goes through the identity operations like any other. */
    invite?: Inviter;
  } = {},
) {
  const record = (actor: ActiveActor, subjectId: string, detail: string) =>
    deps.audit?.(actor.userId, { kind: "workspace", outcome: "ok", subjectId, detail });

  /**
   * Where the person stands, read again inside the transaction: the role an actor carries was read before it. The installation row is
   * locked first, as every identity operation does, so a role change and an invitation or an admin replacement never interleave.
   */
  async function standing(tx: Tx, actor: ActiveActor) {
    const [installation] = await tx
      .select({ rootUserId: installationIdentity.adminUserId })
      .from(installationIdentity)
      .where(eq(installationIdentity.id, 1))
      .for("update");
    if (!installation) throw new AccessError("ACCESS_DENIED");
    const isRoot = installation.rootUserId === actor.userId;
    // The workspace the person works in now (the request's); a person with none yet stands in their first.
    const here = actor.workspaceId ?? tenant.current();
    // Root in its own workspace (the first) is always its owner, its row repaired if it was edited; anywhere else it is what its row says.
    const own = isRoot && (!here || here === (await firstWorkspaceId(tx)));
    const mine = own
      ? await rootPlace(tx, actor.userId)
      : ((here ? await placeIn(tx, actor.userId, here) : undefined) ??
        (isRoot ? undefined : await placeOf(tx, actor.userId)));
    if (!mine) throw new WorkspaceError("NOT_FOUND", "You are in no workspace.");
    return { ...mine, isRoot, rootUserId: installation.rootUserId };
  }

  /** The active people of a workspace, locked in a fixed order. */
  const lockMembers = (tx: Tx, workspaceId: string) =>
    tx
      .select({ userId: workspaceMember.userId, role: workspaceMember.role })
      .from(workspaceMember)
      .innerJoin(membership, eq(membership.userId, workspaceMember.userId))
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.status, "active"),
          eq(membership.status, "active"),
        ),
      )
      .orderBy(asc(workspaceMember.userId))
      .for("update", { of: workspaceMember });

  return {
    /** Every workspace the person is in and that runs, the one they work in now first, for the switcher. Never anyone else's. */
    async all(actor: ActiveActor) {
      const rows = await db
        .select({
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          role: workspaceMember.role,
        })
        .from(workspaceMember)
        .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
        .where(
          and(
            eq(workspaceMember.userId, actor.userId),
            eq(workspaceMember.status, "active"),
            eq(workspace.status, "active"),
          ),
        )
        .orderBy(asc(workspaceMember.joinedAt));
      return {
        workspaces: rows.map((r) => ({ ...r, current: r.id === actor.workspaceId })),
        mayCreate: actor.isRoot === true,
      };
    },

    /**
     * Root starts a workspace for another organization: the workspace, empty, and the invitation of its owner, who then invites their own
     * people. Root has no seat in it: what is inside is that organization's.
     */
    async create(actor: ActiveActor, input: { name: unknown; slug: unknown; ownerEmail: unknown }) {
      if (actor.isRoot !== true) throw new AccessError("ACCESS_DENIED");
      if (!deps.invite) throw new WorkspaceError("NOT_ALLOWED", "Invitations are not available.");
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
      const email = typeof input.ownerEmail === "string" ? input.ownerEmail.trim() : "";
      if (!name || name.length > WORKSPACE_NAME_MAX)
        throw new WorkspaceError(
          "INVALID",
          `A workspace name has 1 to ${WORKSPACE_NAME_MAX} characters.`,
        );
      if (!SLUG.test(slug))
        throw new WorkspaceError(
          "INVALID",
          "The address name has 2 to 63 lowercase letters, digits and dashes, and starts with a letter or digit.",
        );
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
        throw new WorkspaceError(
          "INVALID",
          "Enter the e-mail address of the person who will own it.",
        );
      const [made] = await db
        .insert(workspace)
        .values({ name, slug })
        .onConflictDoNothing({ target: workspace.slug })
        .returning({ id: workspace.id, slug: workspace.slug, name: workspace.name });
      if (!made) throw new WorkspaceError("INVALID", "A workspace already has that address name.");
      // Inside the new workspace: nobody is in it yet, so the invitation is its owner's (identity-hooks.ts, `issued`).
      const sent = await tenant.run(made.id, () =>
        deps.invite!({ userId: actor.userId }, { intendedEmail: email, role: "admin" }),
      );
      record(actor, made.id, "created");
      return { workspace: made, invitation: sent };
    },

    /**
     * A person already on this server joins another workspace with an invitation made out to them. Signing up takes an invitation for a
     * new person (the identity operations, which refuse one for a person already active); this is the same invitation for someone who
     * is here. It is checked as the identity operation checks it (unused, unrevoked, unexpired, for this person's address and account),
     * used up, and the person placed as it says, with the Chief it gives (identity-hooks.ts, `accepted`).
     */
    async join(actor: ActiveActor, rawToken: unknown) {
      const token = typeof rawToken === "string" ? rawToken.trim() : "";
      const refused = () =>
        new WorkspaceError("INVALID", "That invitation cannot be used. Ask for a new one.");
      if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) throw refused();
      const hash = createHash("sha256").update(token).digest("hex");
      const joined = await db.transaction(async (tx) => {
        const [person] = await tx
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, actor.userId));
        if (!person) throw refused();
        const [found] = await tx
          .select({ id: invitation.id, workspaceId: invitationGrant.workspaceId })
          .from(invitation)
          .innerJoin(invitationGrant, eq(invitationGrant.invitationId, invitation.id))
          .where(
            and(
              eq(invitation.tokenHash, hash),
              eq(invitation.intendedEmail, person.email.toLowerCase()),
              or(isNull(invitation.intendedUserId), eq(invitation.intendedUserId, actor.userId)),
              isNull(invitation.revokedAt),
              isNull(invitation.consumedAt),
              gt(invitation.expiresAt, sql`clock_timestamp()`),
            ),
          )
          .for("update", { of: invitation });
        if (!found) throw refused();
        if (await placeIn(tx, actor.userId, found.workspaceId))
          throw new WorkspaceError("INVALID", "You are already in that workspace.");
        await tx
          .update(invitation)
          .set({ consumedAt: sql`clock_timestamp()`, consumedByUserId: actor.userId })
          .where(eq(invitation.id, found.id));
        await enrollmentHooks.accepted!(tx, { invitationId: found.id, userId: actor.userId });
        const [ws] = await tx
          .select({ id: workspace.id, slug: workspace.slug, name: workspace.name })
          .from(workspace)
          .where(eq(workspace.id, found.workspaceId));
        return ws!;
      });
      record(actor, joined.id, "joined");
      return { workspace: joined };
    },

    /** The workspace the person is in, and what they are in it. */
    async mine(actor: ActiveActor) {
      return db.transaction(async (tx) => {
        const me = await standing(tx, actor);
        const [found] = await tx
          .select({ id: workspace.id, slug: workspace.slug, name: workspace.name })
          .from(workspace)
          .where(eq(workspace.id, me.workspaceId))
          .limit(1);
        if (!found) throw new WorkspaceError("NOT_FOUND", "You are in no workspace.");
        return { workspace: found, role: me.role, isRoot: me.isRoot };
      });
    },

    /** Everyone in the administrator's workspace, with their role and the Chief someone shared with them. Never a secret. */
    async members(actor: ActiveActor) {
      if (!actor.isAdmin) throw new AccessError("ACCESS_DENIED");
      return db.transaction(async (tx) => {
        const me = await standing(tx, actor);
        const rows = await tx
          .select({
            userId: workspaceMember.userId,
            name: user.name,
            email: user.email,
            role: workspaceMember.role,
            joinedAt: workspaceMember.joinedAt,
            chiefBotId: chiefShare.botId,
            chiefBotName: bot.name,
            chiefBotAvatar: bot.avatar,
            chiefBotKind: bot.kind,
            chiefOwnerUserId: bot.ownerUserId,
          })
          .from(workspaceMember)
          .innerJoin(membership, eq(membership.userId, workspaceMember.userId))
          .innerJoin(user, eq(user.id, workspaceMember.userId))
          .leftJoin(chiefShare, eq(chiefShare.userId, workspaceMember.userId))
          .leftJoin(bot, eq(bot.id, chiefShare.botId))
          .where(
            and(
              eq(workspaceMember.workspaceId, me.workspaceId),
              eq(workspaceMember.status, "active"),
              eq(membership.status, "active"),
            ),
          )
          .orderBy(asc(user.name), asc(user.id));
        const lines = await deps.people?.lines(rows.map((row) => row.userId));
        return {
          members: rows.map((row) => ({
            userId: row.userId,
            name: row.name,
            email: row.email,
            avatar: lines?.get(row.userId)?.avatar ?? null,
            title: lines?.get(row.userId)?.title ?? "",
            role: row.role,
            isRoot: row.userId === me.rootUserId,
            isYou: row.userId === actor.userId,
            joinedAt: row.joinedAt,
            chief: row.chiefBotId
              ? {
                  botId: row.chiefBotId,
                  name: row.chiefBotName ?? "",
                  avatar: row.chiefBotAvatar ?? null,
                  kind: row.chiefBotKind ?? "specialist",
                  ownerUserId: row.chiefOwnerUserId ?? "",
                }
              : null,
          })),
        };
      });
    },

    /** Invitations of this workspace that can still be used, with what each one gives. Never a token. */
    async invitations(actor: ActiveActor) {
      if (!actor.isAdmin) throw new AccessError("ACCESS_DENIED");
      return db.transaction(async (tx) => {
        const me = await standing(tx, actor);
        const rows = await tx
          .select({
            invitationId: invitation.id,
            intendedEmail: invitation.intendedEmail,
            createdAt: invitation.createdAt,
            expiresAt: invitation.expiresAt,
            role: invitationGrant.role,
            chiefBotId: invitationGrant.chiefBotId,
            chiefBotName: bot.name,
            chiefBotAvatar: bot.avatar,
            chiefBotKind: bot.kind,
          })
          .from(invitation)
          .leftJoin(invitationGrant, eq(invitationGrant.invitationId, invitation.id))
          .leftJoin(bot, eq(bot.id, invitationGrant.chiefBotId))
          .where(
            and(
              isNull(invitation.revokedAt),
              isNull(invitation.consumedAt),
              gt(invitation.expiresAt, sql`clock_timestamp()`),
              // An invitation from before workspaces has no grant and joins the one workspace there was.
              or(
                eq(invitationGrant.workspaceId, me.workspaceId),
                isNull(invitationGrant.workspaceId),
              ),
            ),
          )
          .orderBy(desc(invitation.createdAt));
        return {
          invitations: rows.map((row) => ({
            invitationId: row.invitationId,
            intendedEmail: row.intendedEmail,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            role: row.role ?? "member",
            chief: row.chiefBotId
              ? {
                  botId: row.chiefBotId,
                  name: row.chiefBotName ?? "",
                  avatar: row.chiefBotAvatar ?? null,
                  kind: row.chiefBotKind ?? "specialist",
                }
              : null,
          })),
        };
      });
    },

    /** Changes one person's role. The rule is `refuseRoleChange` (packages/core/src/workspace.ts), applied to rows locked here. */
    async setRole(actor: ActiveActor, userId: string, role: unknown) {
      if (!isWorkspaceRole(role)) throw new WorkspaceError("INVALID", "That is not a role.");
      const changed = await db.transaction(async (tx) => {
        const me = await standing(tx, actor);
        const people = await lockMembers(tx, me.workspaceId);
        const target = people.find((person) => person.userId === userId);
        if (!target) throw new WorkspaceError("NOT_FOUND", "That person is not in this workspace.");
        const refusal = refuseRoleChange({
          actor: me.role,
          self: userId === actor.userId,
          from: target.role,
          to: role,
          owners: people.filter((person) => person.role === "owner").length,
          targetIsRoot: userId === me.rootUserId,
        });
        if (refusal) throw new WorkspaceError("NOT_ALLOWED", ROLE_CHANGE_REFUSALS[refusal]);
        await tx
          .update(workspaceMember)
          .set({ role, updatedAt: sql`clock_timestamp()` })
          .where(
            and(
              eq(workspaceMember.workspaceId, me.workspaceId),
              eq(workspaceMember.userId, userId),
            ),
          );
        return { userId, role: role as WorkspaceRole };
      });
      record(actor, userId, `role:${changed.role}`);
      return changed;
    },

    /** Gives a bot of the administrator's to a person as their Chief, or (`null`) takes the shared Chief away, whoever shared it. */
    async setChief(actor: ActiveActor, userId: string, botId: string | null) {
      await db.transaction(async (tx) => {
        const me = await standing(tx, actor);
        if (!administers(me.role)) throw new AccessError("ACCESS_DENIED");
        const people = await lockMembers(tx, me.workspaceId);
        if (!people.some((person) => person.userId === userId))
          throw new WorkspaceError("NOT_FOUND", "That person is not in this workspace.");
        if (botId === null) {
          await tx.delete(chiefShare).where(eq(chiefShare.userId, userId));
          return;
        }
        if (userId === actor.userId)
          throw new WorkspaceError("INVALID", "A bot of yours is already yours to talk to.");
        const [own] = await tx
          .select({ id: bot.id })
          .from(bot)
          .where(and(eq(bot.id, botId), eq(bot.ownerUserId, actor.userId), eq(bot.archived, false)))
          .limit(1);
        if (!own) throw new WorkspaceError("NOT_FOUND", "Choose one of your own bots.");
        await tx
          .insert(chiefShare)
          .values({ userId, botId, grantedByUserId: actor.userId })
          .onConflictDoUpdate({
            target: [chiefShare.workspaceId, chiefShare.userId],
            set: { botId, grantedByUserId: actor.userId, createdAt: sql`clock_timestamp()` },
          });
      });
      record(actor, userId, botId ? "chief:set" : "chief:removed");
      return { userId, botId };
    },

    /** The name people see. An owner's to change. */
    async rename(actor: ActiveActor, rawName: unknown) {
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!name || name.length > WORKSPACE_NAME_MAX)
        throw new WorkspaceError(
          "INVALID",
          `A workspace name has 1 to ${WORKSPACE_NAME_MAX} characters.`,
        );
      const renamed = await db.transaction(async (tx) => {
        const me = await standing(tx, actor);
        if (me.role !== "owner") throw new AccessError("ACCESS_DENIED");
        await tx.update(workspace).set({ name }).where(eq(workspace.id, me.workspaceId));
        return { id: me.workspaceId, name };
      });
      record(actor, renamed.id, "name");
      return renamed;
    },
  };
}
export type WorkspaceService = ReturnType<typeof createWorkspaceService>;

// The workspace side of the identity operations. Every function here runs inside an identity transaction (enrollment.ts,
// admin-lifecycle.ts), after its locks, so a person's membership and their place in a workspace are written together or not at all.
import { administers, mayInvite, type WorkspaceRole } from "@zetta/core/workspace";
import { asWorkspace, tenant } from "@zetta/db";
import { and, asc, eq, sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { invitation } from "@zetta/db/schema/identity";
import {
  chiefShare,
  invitationGrant,
  workspace,
  workspaceMember,
} from "@zetta/db/schema/workspaces";
import type { AdminLifecycleHooks } from "../identity/admin-lifecycle";
import type { EnrollmentHooks, EnrollmentTransaction } from "../identity/enrollment";

type Tx = EnrollmentTransaction;

/** The slug of the workspace the first account gets. */
export const FIRST_WORKSPACE = { slug: "main", name: "Workspace" } as const;

export async function placeOf(tx: Tx, userId: string) {
  const [row] = await tx
    .select({ workspaceId: workspaceMember.workspaceId, role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.status, "active")))
    .orderBy(asc(workspaceMember.joinedAt))
    .limit(1);
  return row;
}

/** A person's place in one workspace, if they are an active member of it. */
export async function placeIn(tx: Tx, userId: string, workspaceId: string) {
  const [row] = await tx
    .select({ workspaceId: workspaceMember.workspaceId, role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "active"),
      ),
    )
    .limit(1);
  return row;
}

/** A workspace nobody is in yet: one root has just made for another organization. */
async function empty(tx: Tx, workspaceId: string) {
  const [anyone] = await tx
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(eq(workspaceMember.workspaceId, workspaceId))
    .limit(1);
  return !anyone;
}

/** The first workspace: root's own, made with the server. */
export async function firstWorkspaceId(tx: Tx) {
  const [row] = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .orderBy(asc(workspace.createdAt), asc(workspace.id))
    .limit(1);
  return row?.id;
}

/** The first workspace, created when it is not there. Two callers that race insert one row: the slug is unique. */
async function firstWorkspace(tx: Tx): Promise<string> {
  await tx
    .insert(workspace)
    .values(FIRST_WORKSPACE)
    .onConflictDoNothing({ target: workspace.slug });
  const [row] = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .orderBy(asc(workspace.createdAt))
    .limit(1);
  if (!row) throw new Error("no workspace");
  return row.id;
}

async function place(tx: Tx, workspaceId: string, userId: string, role: WorkspaceRole) {
  await tx
    .insert(workspaceMember)
    .values({ workspaceId, userId, role, status: "active", removedAt: null })
    .onConflictDoUpdate({
      target: [workspaceMember.workspaceId, workspaceMember.userId],
      set: { role, status: "active", removedAt: null, updatedAt: sql`clock_timestamp()` },
    });
}

/** Where root stands: their own row, or the first workspace as its owner when a server from before workspaces has no row for them. */
export async function rootPlace(tx: Tx, userId: string) {
  const found = await placeOf(tx, userId);
  if (found?.role === "owner") return found;
  const workspaceId = found?.workspaceId ?? (await firstWorkspace(tx));
  await place(tx, workspaceId, userId, "owner");
  return { workspaceId, role: "owner" as const };
}

export const enrollmentHooks: EnrollmentHooks = {
  /** Whether the person administers the workspace the request works in (their first one, with none). */
  async administers(tx, userId) {
    const here = tenant.current();
    const found = here ? await placeIn(tx, userId, here) : await placeOf(tx, userId);
    return found ? administers(found.role) : false;
  },

  /**
   * The invitation joins the workspace its sender works in now. Root inviting into a workspace nobody is in yet (one made for another
   * organization) invites its owner: that is how a new organization starts, and root has no seat in it.
   */
  async issued(tx, grant) {
    const here = tenant.current();
    let issuer: { workspaceId: string; role: WorkspaceRole } | undefined;
    let role: WorkspaceRole = grant.role;
    if (!here)
      issuer = grant.issuerIsRoot
        ? await rootPlace(tx, grant.issuerUserId)
        : await placeOf(tx, grant.issuerUserId);
    else {
      issuer = await placeIn(tx, grant.issuerUserId, here);
      if (!issuer && grant.issuerIsRoot && (await empty(tx, here))) {
        if (grant.chiefBotId) throw new Error("bot not allowed");
        issuer = { workspaceId: here, role: "owner" };
        role = "owner";
      }
    }
    if (!issuer || (role !== "owner" && !mayInvite(issuer.role, grant.role)))
      throw new Error("role not allowed");
    if (grant.chiefBotId) {
      // Root may invite from a request that stood in no workspace yet: the bot is looked up in the workspace the invitation is for.
      await asWorkspace(tx, issuer.workspaceId);
      // Only a bot of the person who invites: they are the one who answers for what it does in the new person's chats.
      const [own] = await tx
        .select({ id: bot.id })
        .from(bot)
        .where(
          and(
            eq(bot.id, grant.chiefBotId),
            eq(bot.ownerUserId, grant.issuerUserId),
            eq(bot.archived, false),
          ),
        )
        .limit(1);
      if (!own) throw new Error("bot not allowed");
    }
    await tx.insert(invitationGrant).values({
      invitationId: grant.invitationId,
      workspaceId: issuer.workspaceId,
      role,
      chiefBotId: grant.chiefBotId,
    });
  },

  async accepted(tx, joined) {
    const [found] = await tx
      .select({
        issuerUserId: invitation.issuedByUserId,
        workspaceId: invitationGrant.workspaceId,
        role: invitationGrant.role,
        chiefBotId: invitationGrant.chiefBotId,
      })
      .from(invitation)
      .leftJoin(invitationGrant, eq(invitationGrant.invitationId, invitation.id))
      .where(eq(invitation.id, joined.invitationId))
      .limit(1);
    if (!found) throw new Error("no invitation");
    // An invitation from before workspaces has no grant: it joins where the person who sent it is, as a member.
    const workspaceId =
      found.workspaceId ??
      (await placeOf(tx, found.issuerUserId))?.workspaceId ??
      (await firstWorkspace(tx));
    await place(tx, workspaceId, joined.userId, found.role ?? "member");
    if (!found.chiefBotId) return;
    // The new person has no workspace yet in the request that signs them up: the bot and the share are those of the invitation's.
    await asWorkspace(tx, workspaceId);
    // The bot may have been archived or given away since the invitation was sent: then the person simply gets a Chief of their own.
    const [still] = await tx
      .select({ id: bot.id })
      .from(bot)
      .where(
        and(
          eq(bot.id, found.chiefBotId),
          eq(bot.ownerUserId, found.issuerUserId),
          eq(bot.archived, false),
        ),
      )
      .limit(1);
    if (!still) return;
    await tx
      .insert(chiefShare)
      .values({ userId: joined.userId, botId: still.id, grantedByUserId: found.issuerUserId })
      .onConflictDoUpdate({
        target: [chiefShare.workspaceId, chiefShare.userId],
        set: { botId: still.id, grantedByUserId: found.issuerUserId },
      });
  },
};

/**
 * The operator command also runs against a database that was never migrated past the identity tables (its proof, a server being
 * repaired). There is no workspace to write there, and root administers without a row (lookup.ts).
 */
async function hasWorkspaces(tx: Tx): Promise<boolean> {
  const found = await tx.execute<{ there: boolean }>(
    sql`select to_regclass('zetta.workspace_member') is not null as there`,
  );
  return found.rows[0]?.there === true;
}

export const adminLifecycleHooks: AdminLifecycleHooks = {
  async bootstrapped(tx, userId) {
    if (!(await hasWorkspaces(tx))) return;
    await place(tx, await firstWorkspace(tx), userId, "owner");
  },

  /** The new admin owns the workspace the previous one was in. The previous admin stays in it as a member, as the operation promises. */
  async replaced(tx, { previous, next }) {
    if (!(await hasWorkspaces(tx))) return;
    const workspaceId = (await placeOf(tx, previous))?.workspaceId ?? (await firstWorkspace(tx));
    await place(tx, workspaceId, next, "owner");
    await place(tx, workspaceId, previous, "member");
  },
};

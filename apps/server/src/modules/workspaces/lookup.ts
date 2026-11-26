import { administers } from "@zetta/core/workspace";
import type { Database } from "@zetta/db";
import { and, asc, eq, sql } from "@zetta/db/query";
import { installationIdentity, membership } from "@zetta/db/schema/identity";
import { workspace as workspaceTable, workspaceMember } from "@zetta/db/schema/workspaces";
import type { MembershipLookup } from "../identity/access";

/**
 * The membership lookup the server runs with: an active member, their workspace and their role in it. `membership` still decides whether
 * a person may use this server at all; a person with no active row there is nobody here, whatever their workspace row says.
 *
 * Root is the person who set the server up. Root always administers, also when the workspace row is missing or its role was edited by
 * hand: nobody can be locked out of their own server by a role.
 */
/** The first workspace: root's own. */
async function firstWorkspace(db: Pick<Database, "select">) {
  const [row] = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(eq(workspaceTable.status, "active"))
    .orderBy(asc(workspaceTable.createdAt), asc(workspaceTable.id))
    .limit(1);
  return row?.id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createWorkspaceLookup(db: Pick<Database, "select">): MembershipLookup {
  return async (userId, workspace) => {
    const [row] = await db
      .select({
        adminUserId: installationIdentity.adminUserId,
        // The workspace only when it runs (the join below): a person in a suspended one stands nowhere there.
        workspaceId: workspaceTable.id,
        role: workspaceMember.role,
        // Whether the person ever had a place in a workspace, whatever its state now.
        placed: sql<boolean>`exists (select 1 from zetta.workspace_member p where p.user_id = ${membership.userId})`,
        // Root's own workspace: the first, made with the server.
        own: sql<boolean>`${workspaceTable.id} = (select f.id from zetta.workspace f order by f.created_at, f.id limit 1)`,
      })
      .from(membership)
      .leftJoin(installationIdentity, eq(installationIdentity.id, 1))
      .leftJoin(
        workspaceMember,
        and(eq(workspaceMember.userId, membership.userId), eq(workspaceMember.status, "active")),
      )
      // Only a workspace that runs: a suspended or deleted one has nobody in it.
      .leftJoin(
        workspaceTable,
        and(
          eq(workspaceTable.id, workspaceMember.workspaceId),
          eq(workspaceTable.status, "active"),
        ),
      )
      .where(
        and(
          eq(membership.userId, userId),
          eq(membership.status, "active"),
          ...(workspace
            ? [
                UUID.test(workspace)
                  ? eq(workspaceTable.id, workspace)
                  : eq(workspaceTable.slug, workspace),
              ]
            : []),
        ),
      )
      // With no workspace named: the first they joined that runs.
      .orderBy(sql`${workspaceTable.id} is null`, asc(workspaceMember.joinedAt))
      .limit(1);
    if (!row) return null;
    // Asked about a workspace the person is not in: nobody there, root included. Running this server gives no seat in a workspace of
    // another organization: what crosses workspaces is the operator command's (docs/decisions/workspaces.md).
    if (workspace && !row.workspaceId) return null;
    const root = row.adminUserId === userId;
    const role = (row.workspaceId ? row.role : null) ?? (root ? "owner" : "member");
    // Root with no row of its own (a server from before workspaces) stands in its own, the first.
    const workspaceId =
      row.workspaceId ?? (root && !workspace ? await firstWorkspace(db) : undefined);
    return {
      // Root always administers its own workspace, whatever a hand-edited row says, so nobody is locked out of their own server. In a
      // workspace of another organization root is what its row says, like anyone: running the server gives no say there.
      isAdmin: administers(role) || (root && (row.own === true || !row.workspaceId)),
      isRoot: root,
      role,
      ...(workspaceId ? { workspaceId } : row.placed && !root ? { place: "nowhere" as const } : {}),
    };
  };
}

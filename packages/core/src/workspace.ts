/**
 * A workspace is one organization on a Zetta server, and each of its people has one role in it. Everything here is pure (no database, no
 * web), so the server checks a role change with the same function the web app uses to hide what a person may not do.
 *
 * `root` is not a role: it is the one person who set the server up (`installation_identity.admin_user_id`). Root owns the first workspace,
 * and alone changes what belongs to the whole server (the settings of scope `installation`, the keys of the server's own services).
 */

/** `owner` and `admin` administer the workspace; an owner also decides who the owners and admins are. */
export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  member: "Member",
};

/** What an invitation may grant. Ownership is given to a person who is already in the workspace, never by a link. */
export const INVITE_ROLES = ["admin", "member"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const WORKSPACE_STATES = ["active", "suspended", "deleting", "deleted"] as const;
export type WorkspaceState = (typeof WORKSPACE_STATES)[number];

export const WORKSPACE_NAME_MAX = 80;
export const WORKSPACE_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const isWorkspaceRole = (value: unknown): value is WorkspaceRole =>
  WORKSPACE_ROLES.includes(value as WorkspaceRole);
export const isInviteRole = (value: unknown): value is InviteRole =>
  INVITE_ROLES.includes(value as InviteRole);

/** The people who administer a workspace: invitations, roles, the chart, the workspace's own settings. */
export const administers = (role: WorkspaceRole) => role === "owner" || role === "admin";

/** Whether a person with `actor` may send an invitation that grants `grant`. */
export const mayInvite = (actor: WorkspaceRole, grant: InviteRole) =>
  actor === "owner" || (actor === "admin" && grant === "member");

export type RoleChange = Readonly<{
  /** The role of the person who asks. */
  actor: WorkspaceRole;
  /** True when the person changes their own role. */
  self: boolean;
  /** The role the other person has now, and the one asked for. */
  from: WorkspaceRole;
  to: WorkspaceRole;
  /** How many active owners the workspace has now. */
  owners: number;
  /** True when the person whose role changes is root: root always owns the first workspace. */
  targetIsRoot: boolean;
}>;

export type RoleChangeRefusal = "not_allowed" | "last_owner" | "root_owner" | "unchanged";

/**
 * Why a role change is refused, or null when it may happen. An owner sets any role. An administrator moves people between member and
 * administrator, and touches no owner. A workspace always keeps one owner, and root stays an owner.
 */
export function refuseRoleChange(change: RoleChange): RoleChangeRefusal | null {
  const { actor, from, to } = change;
  if (from === to) return "unchanged";
  if (actor === "member") return "not_allowed";
  if (actor === "admin" && (from === "owner" || to === "owner" || change.self))
    return "not_allowed";
  if (from === "owner") {
    if (change.targetIsRoot) return "root_owner";
    if (change.owners <= 1) return "last_owner";
  }
  return null;
}

export const ROLE_CHANGE_REFUSALS: Record<RoleChangeRefusal, string> = {
  not_allowed: "Your role does not allow this change.",
  last_owner: "A workspace keeps at least one owner. Make another person an owner first.",
  root_owner: "The person who set this server up stays an owner.",
  unchanged: "That is already this person's role.",
};

/** What a workspace's use is counted in, each month: bot runs, and the seconds they took. */
export const USAGE_METRICS = ["runs", "run_seconds"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

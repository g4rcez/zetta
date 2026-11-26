import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { USAGE_METRICS, WORKSPACE_ROLES } from "@zetta/core/workspace";
import { zetta } from "./pg-schema";
import { inWorkspace, workspace } from "./workspace-table";

import { user } from "./auth";
import { bot } from "./chat";
import { invitation } from "./identity";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const stamp = (name: string) => timestamp(name, { withTimezone: true }).defaultNow().notNull();

export { workspace };

/**
 * A person's place and role in a workspace. `membership` (schema/identity.ts) still says whether the person may use this server at all,
 * with its activation revision; this table says where and as what. A removed row is kept, as in `membership`.
 */
export const workspaceMember = zetta.table(
  "workspace_member",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, restrict),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, restrict),
    role: text("role", { enum: WORKSPACE_ROLES }).notNull(),
    status: text("status", { enum: ["active", "removed"] }).notNull(),
    joinedAt: stamp("joined_at"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    updatedAt: stamp("updated_at"),
  },
  (t) => [
    primaryKey({ name: "workspace_member_pkey", columns: [t.workspaceId, t.userId] }),
    index("workspace_member_user_id_idx").on(t.userId),
    check("workspace_member_role_check", sql`${t.role} in ('owner', 'admin', 'member')`),
    check("workspace_member_status_check", sql`${t.status} in ('active', 'removed')`),
    check(
      "workspace_member_removal_check",
      sql`(${t.status} = 'active' and ${t.removedAt} is null) or (${t.status} = 'removed' and ${t.removedAt} is not null)`,
    ),
  ],
);

/**
 * What an invitation gives beyond the membership itself: the workspace, the role, and a bot of the inviter's that becomes the new person's
 * Chief. It is a table of its own so the `invitation` table keeps the shape its proofs pin. An invitation with no row here joins the
 * inviter's workspace as a member.
 */
export const invitationGrant = zetta.table(
  "invitation_grant",
  {
    invitationId: text("invitation_id")
      .primaryKey()
      .references(() => invitation.id, { onDelete: "cascade", onUpdate: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, restrict),
    // `owner` only for the first person root invites into a workspace nobody is in yet (modules/workspaces/identity-hooks.ts).
    role: text("role", { enum: WORKSPACE_ROLES }).default("member").notNull(),
    chiefBotId: uuid("chief_bot_id").references(() => bot.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
  },
  (t) => [
    index("invitation_grant_workspace_id_idx").on(t.workspaceId),
    index("invitation_grant_chief_bot_id_idx").on(t.chiefBotId),
    check("invitation_grant_role_check", sql`${t.role} in ('owner', 'admin', 'member')`),
  ],
);

/**
 * A bot that its owner gave to another person as that person's Chief. The bot stays its owner's: the person talks to it in their own
 * chats, and has no private Chief while this row exists. One per person in each workspace, and the bot is of that workspace. Deleting
 * the bot ends the share.
 */
export const chiefShare = zetta.table(
  "chief_share",
  {
    workspaceId: inWorkspace(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, { onDelete: "cascade", onUpdate: "restrict" }),
    grantedByUserId: text("granted_by_user_id")
      .notNull()
      .references(() => user.id, restrict),
    createdAt: stamp("created_at"),
  },
  (t) => [
    primaryKey({ name: "chief_share_pkey", columns: [t.workspaceId, t.userId] }),
    foreignKey({
      name: "chief_share_bot_id_workspace_fkey",
      columns: [t.botId, t.workspaceId],
      foreignColumns: [bot.id, bot.workspaceId],
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    index("chief_share_bot_id_idx").on(t.botId),
    index("chief_share_granted_by_user_id_idx").on(t.grantedByUserId),
  ],
);

/**
 * What root lets a workspace use each month (docs/decisions/workspaces.md, "Quotas"): bot runs and their time. An empty limit is no
 * limit. One row per workspace, root's to set; shared by every workspace's view of itself, so it carries no row rule.
 */
export const workspaceQuota = zetta.table(
  "workspace_quota",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspace.id, restrict),
    runsPerMonth: integer("runs_per_month"),
    runSecondsPerMonth: integer("run_seconds_per_month"),
    updatedBy: text("updated_by"),
    updatedAt: stamp("updated_at"),
  },
  (t) => [
    check(
      "workspace_quota_limits_check",
      sql`coalesce(${t.runsPerMonth}, 0) >= 0 and coalesce(${t.runSecondsPerMonth}, 0) >= 0`,
    ),
  ],
);

/**
 * How much a workspace used in a month: bot runs and their seconds, counted as they end (modules/workspaces/quotas.ts). The operator's
 * view across workspaces, written with the workspace named, so it carries no row rule.
 */
export const usageCounter = zetta.table(
  "usage_counter",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, restrict),
    /** `YYYY-MM`, in UTC. */
    period: text("period").notNull(),
    metric: text("metric", { enum: USAGE_METRICS }).notNull(),
    value: bigint("value", { mode: "number" }).default(0).notNull(),
  },
  (t) => [
    primaryKey({ name: "usage_counter_pkey", columns: [t.workspaceId, t.period, t.metric] }),
    check("usage_counter_metric_check", sql`${t.metric} in ('runs', 'run_seconds')`),
    check("usage_counter_period_check", sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

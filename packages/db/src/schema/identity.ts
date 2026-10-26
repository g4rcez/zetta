import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const membership = pgTable(
  "membership",
  {
    userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
    activationRevision: integer("activation_revision").default(1).notNull(),
    status: text("status", { enum: ["active", "removed"] }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("membership_activation_revision_check", sql`${table.activationRevision} between 1 and 2147483647`),
    unique("membership_user_status_unique").on(table.userId, table.status),
    check("membership_status_check", sql`${table.status} in ('active', 'removed')`),
    check("membership_removal_check", sql`
      (${table.status} = 'active' and ${table.removedAt} is null)
      or (${table.status} = 'removed' and ${table.removedAt} is not null)
    `),
  ],
);

// One active-admin pointer per existing singleton; privileged deletion of the
// singleton still requires operator/application controls, not these constraints.
export const installationIdentity = pgTable(
  "installation_identity",
  {
    id: integer("id").primaryKey(),
    adminUserId: text("admin_user_id").notNull(),
    adminMembershipStatus: text("admin_membership_status", { enum: ["active"] }).default("active").notNull(),
    bootstrappedAt: timestamp("bootstrapped_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("installation_identity_singleton_check", sql`${table.id} = 1`),
    check("installation_identity_admin_active_check", sql`${table.adminMembershipStatus} = 'active'`),
    foreignKey({
      name: "installation_identity_active_admin_fk",
      columns: [table.adminUserId, table.adminMembershipStatus],
      foreignColumns: [membership.userId, membership.status],
    }).onDelete("restrict").onUpdate("restrict"),
  ],
);

// Token generation/hashing, lowercase account binding and the 24-hour expiry
// policy are service responsibilities. No raw token or enrollment role is stored.
export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    intendedEmail: text("intended_email").notNull(),
    intendedUserId: text("intended_user_id").references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
    issuedByUserId: text("issued_by_user_id").notNull().references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByUserId: text("consumed_by_user_id").references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
  },
  (table) => [
    unique("invitation_token_hash_unique").on(table.tokenHash),
    check("invitation_email_canonical_check", sql`${table.intendedEmail} = lower(${table.intendedEmail})`),
    check("invitation_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("invitation_consumption_check", sql`(${table.consumedAt} is null) = (${table.consumedByUserId} is null)`),
  ],
);

export const identityAudit = pgTable(
  "identity_audit",
  {
    id: text("id").primaryKey(),
    eventKind: text("event_kind", {
      enum: ["bootstrap", "admin-replacement", "invite-issued", "invite-revoked", "invite-consumed"],
    }).notNull(),
    actorKind: text("actor_kind", { enum: ["operator", "user"] }).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
    subjectUserId: text("subject_user_id").references(() => user.id, { onDelete: "restrict", onUpdate: "restrict" }),
    invitationId: text("invitation_id").references(() => invitation.id, { onDelete: "restrict", onUpdate: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    operatorReason: text("operator_reason"),
  },
  (table) => [
    check("identity_audit_event_kind_check", sql`${table.eventKind} in ('bootstrap', 'admin-replacement', 'invite-issued', 'invite-revoked', 'invite-consumed')`),
    check("identity_audit_actor_kind_check", sql`${table.actorKind} in ('operator', 'user')`),
    check("identity_audit_actor_check", sql`
      (${table.actorKind} = 'operator' and ${table.actorUserId} is null)
      or (${table.actorKind} = 'user' and ${table.actorUserId} is not null)
    `),
    check("identity_audit_replacement_reason_check", sql`
      ${table.eventKind} <> 'admin-replacement'
      or (${table.actorKind} = 'operator' and ${table.operatorReason} is not null and length(btrim(${table.operatorReason})) > 0)
    `),
  ],
);

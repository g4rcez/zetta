import { sql, type SQLWrapper } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";
import { runAttempts } from "./runs";

const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });
const finite = (column: SQLWrapper) =>
  sql`(${column} is null or (isfinite(${column}) and extract(epoch from ${column}) * 1000 between -8640000000000000 and 8640000000000000))`;
const identifier = (column: SQLWrapper) => sql`${column} collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'`;
const digest = (column: SQLWrapper) => sql`${column} collate "C" ~ '^[a-f0-9]{64}$'`;
const factTime = (column: SQLWrapper, created: SQLWrapper, updated: SQLWrapper) =>
  sql`(${column} is null or (${column} >= ${created} and ${column} <= ${updated}))`;
const states = [
  "not_submitted",
  "prepare_pending",
  "prepared",
  "active",
  "stopping",
  "unknown",
  "cleaned",
] as const;
const operations = ["prepare", "activate", "input", "stop", "remove"] as const;
const grantStates = ["pending", "issued", "cancelled", "expired", "uncertain"] as const;

// Explicit operator bootstrap only; this row is a mutex, never an occupancy counter.
export const dispatchCapacity = zetta.table(
  "dispatch_capacity",
  {
    id: integer("id").primaryKey(),
    launcherInstallationId: text("launcher_installation_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    globalLimit: integer("global_limit").notNull(),
    actorLimit: integer("actor_limit").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    unique("dispatch_capacity_installation_policy_unique").on(
      t.launcherInstallationId,
      t.policyVersion,
    ),
    check("dispatch_capacity_singleton_check", sql`${t.id} = 1`),
    check("dispatch_capacity_limits_check", sql`${t.globalLimit} = 2 and ${t.actorLimit} = 1`),
    check(
      "dispatch_capacity_identifiers_check",
      sql`${identifier(t.launcherInstallationId)} and ${identifier(t.policyVersion)}`,
    ),
    check("dispatch_capacity_time_check", finite(t.createdAt)),
  ],
);

// Lease expiry/logical outcome remain in run_attempts. Cleanup provenance is a service obligation.
export const dispatchClaims = zetta.table(
  "dispatch_claims",
  {
    attemptId: uuid("attempt_id").primaryKey(),
    runId: uuid("run_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    generation: integer("generation").notNull(),
    leaseId: uuid("lease_id").notNull(),
    claimOperationId: uuid("claim_operation_id").notNull(),
    launcherInstallationId: text("launcher_installation_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    launchSpecVersion: integer("launch_spec_version").notNull(),
    launchSpecCanonical: text("launch_spec_canonical").notNull(),
    launchSpecDigest: text("launch_spec_digest").notNull(),
    launchIdentityDigest: text("launch_identity_digest").notNull(),
    imageDigest: text("image_digest").notNull(),
    deadlineAt: instant("deadline_at").notNull(),
    receiptId: uuid("receipt_id"),
    prepareIntentAt: instant("prepare_intent_at"),
    resourceState: text("resource_state", { enum: states }).notNull(),
    pendingOperationId: uuid("pending_operation_id"),
    pendingOperationKind: text("pending_operation_kind", { enum: operations }),
    cleanupKind: text("cleanup_kind", { enum: ["not_submitted", "removed"] }),
    cleanupConfirmedAt: instant("cleanup_confirmed_at"),
    cancelReason: text("cancel_reason", {
      enum: ["owner", "deadline", "revocation", "shutdown", "recovery"],
    }),
    cancelRequestedAt: instant("cancel_requested_at"),
    releasedAt: instant("released_at"),
    revision: integer("revision").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [
    index("dispatch_claims_launcher_installation_id_policy_version_idx").on(
      t.launcherInstallationId,
      t.policyVersion,
    ),
    unique("dispatch_claims_operation_unique").on(t.claimOperationId),
    unique("dispatch_claims_attempt_run_owner_unique").on(t.attemptId, t.runId, t.ownerUserId),
    unique("dispatch_claims_installation_receipt_unique").on(t.launcherInstallationId, t.receiptId),
    foreignKey({
      name: "dispatch_claims_attempt_fk",
      columns: [t.attemptId, t.runId, t.ownerUserId],
      foreignColumns: [runAttempts.id, runAttempts.runId, runAttempts.ownerUserId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "dispatch_claims_policy_fk",
      columns: [t.launcherInstallationId, t.policyVersion],
      foreignColumns: [dispatchCapacity.launcherInstallationId, dispatchCapacity.policyVersion],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("dispatch_claims_occupied_owner_idx")
      .on(t.launcherInstallationId, t.ownerUserId)
      .where(sql`${t.releasedAt} is null`),
    index("dispatch_claims_occupied_attempt_idx")
      .on(t.launcherInstallationId, t.attemptId)
      .where(sql`${t.releasedAt} is null`),
    check(
      "dispatch_claims_identifiers_check",
      sql`${identifier(t.ownerUserId)} and ${identifier(t.launcherInstallationId)} and ${identifier(t.policyVersion)}`,
    ),
    check(
      "dispatch_claims_counters_check",
      sql`${t.generation} between 1 and 2147483647 and ${t.revision} between 1 and 2147483647`,
    ),
    check(
      "dispatch_claims_payload_check",
      sql`${t.launchSpecVersion} = 1 and octet_length(${t.launchSpecCanonical}) between 1 and 16384 and ${t.launchSpecCanonical} is json array
    and ${digest(t.launchSpecDigest)} and ${digest(t.launchIdentityDigest)} and ${t.imageDigest} collate "C" ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    check(
      "dispatch_claims_deadline_check",
      sql`${t.deadlineAt} > ${t.createdAt} and ${t.deadlineAt} <= ${t.createdAt} + interval '60 seconds'`,
    ),
    check(
      "dispatch_claims_state_check",
      sql`${t.resourceState} in ('not_submitted','prepare_pending','prepared','active','stopping','unknown','cleaned')
    and ((${t.resourceState} = 'not_submitted' and ${t.prepareIntentAt} is null and ${t.receiptId} is null and ${t.pendingOperationId} is null)
      or (${t.resourceState} <> 'not_submitted' and ${t.prepareIntentAt} is not null))
    and (${t.receiptId} is null or ${t.prepareIntentAt} is not null)
    and (${t.resourceState} not in ('prepared','active','stopping','cleaned') or ${t.receiptId} is not null)
    and (${t.resourceState} <> 'prepare_pending' or (${t.pendingOperationKind} is not null and ${t.pendingOperationKind} = 'prepare' and ${t.receiptId} is null))`,
    ),
    check(
      "dispatch_claims_pending_check",
      sql`((${t.pendingOperationId} is null and ${t.pendingOperationKind} is null)
    or (${t.pendingOperationId} is not null and ${t.pendingOperationKind} is not null and ${t.pendingOperationKind} in ('prepare','activate','input','stop','remove')))
    and (${t.pendingOperationKind} is null or ${t.pendingOperationKind} = 'prepare' or ${t.receiptId} is not null)`,
    ),
    check(
      "dispatch_claims_cleanup_check",
      sql`((${t.cleanupKind} is null and ${t.cleanupConfirmedAt} is null)
    or (${t.cleanupKind} is not null and ${t.cleanupConfirmedAt} is not null and ${t.pendingOperationId} is null
      and ((${t.cleanupKind} = 'not_submitted' and ${t.resourceState} = 'not_submitted' and ${t.prepareIntentAt} is null and ${t.receiptId} is null)
        or (${t.cleanupKind} = 'removed' and ${t.resourceState} = 'cleaned' and ${t.receiptId} is not null and ${t.prepareIntentAt} is not null))))
    and (${t.resourceState} <> 'cleaned' or (${t.cleanupKind} is not null and ${t.cleanupKind} = 'removed'))`,
    ),
    check(
      "dispatch_claims_release_check",
      sql`${t.releasedAt} is null or (${t.cleanupKind} is not null and ${t.cleanupConfirmedAt} is not null
    and ${t.pendingOperationId} is null and ${t.releasedAt} >= ${t.cleanupConfirmedAt})`,
    ),
    check(
      "dispatch_claims_cancel_check",
      sql`(${t.cancelReason} is null and ${t.cancelRequestedAt} is null)
    or (${t.cancelReason} is not null and ${t.cancelRequestedAt} is not null and ${t.cancelReason} in ('owner','deadline','revocation','shutdown','recovery')
      and (${t.cancelReason} <> 'deadline' or ${t.cancelRequestedAt} >= ${t.deadlineAt}))`,
    ),
    check(
      "dispatch_claims_time_check",
      sql`${sql.join([t.createdAt, t.updatedAt, t.deadlineAt, t.prepareIntentAt, t.cleanupConfirmedAt, t.cancelRequestedAt, t.releasedAt].map(finite), sql` and `)}
    and ${t.updatedAt} >= ${t.createdAt}
    and ${sql.join(
      [t.prepareIntentAt, t.cleanupConfirmedAt, t.cancelRequestedAt, t.releasedAt].map((c) =>
        factTime(c, t.createdAt, t.updatedAt),
      ),
      sql` and `,
    )}`,
    ),
  ],
);

// Fixture-only actions; immutable canonical strings still require the trusted service decoder.
export const dispatchGrants = zetta.table(
  "dispatch_grants",
  {
    id: uuid("id").primaryKey(),
    attemptId: uuid("attempt_id").notNull(),
    runId: uuid("run_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    actionId: uuid("action_id").notNull(),
    kind: text("kind", { enum: ["activate", "input"] }).notNull(),
    sequence: integer("sequence").notNull(),
    canonicalAction: text("canonical_action").notNull(),
    actionDigest: text("action_digest").notNull(),
    connectionId: uuid("connection_id"),
    credentialVersion: integer("credential_version"),
    expiresAt: instant("expires_at").notNull(),
    state: text("state", { enum: grantStates }).notNull(),
    deliveryOutcome: text("delivery_outcome", {
      enum: ["not_attempted", "acknowledged", "unknown"],
    }).notNull(),
    issuedAt: instant("issued_at"),
    cancelledAt: instant("cancelled_at"),
    revision: integer("revision").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [
    index("dispatch_grants_attempt_id_run_id_owner_user_id_idx").on(
      t.attemptId,
      t.runId,
      t.ownerUserId,
    ),
    unique("dispatch_grants_attempt_action_unique").on(t.attemptId, t.actionId),
    unique("dispatch_grants_attempt_sequence_unique").on(t.attemptId, t.kind, t.sequence),
    foreignKey({
      name: "dispatch_grants_claim_fk",
      columns: [t.attemptId, t.runId, t.ownerUserId],
      foreignColumns: [dispatchClaims.attemptId, dispatchClaims.runId, dispatchClaims.ownerUserId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("dispatch_grants_attempt_id_idx").on(t.attemptId, t.id),
    check("dispatch_grants_owner_check", identifier(t.ownerUserId)),
    check("dispatch_grants_revision_check", sql`${t.revision} between 1 and 2147483647`),
    check(
      "dispatch_grants_action_check",
      sql`(${t.kind} = 'activate' and ${t.sequence} = 1) or (${t.kind} = 'input' and ${t.sequence} between 1 and 65537)`,
    ),
    check(
      "dispatch_grants_payload_check",
      sql`octet_length(${t.canonicalAction}) between 1 and 16384 and ${t.canonicalAction} is json array and ${digest(t.actionDigest)}`,
    ),
    check(
      "dispatch_grants_credentials_check",
      sql`${t.connectionId} is null and ${t.credentialVersion} is null`,
    ),
    check(
      "dispatch_grants_expiry_check",
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '30 seconds'`,
    ),
    check(
      "dispatch_grants_state_check",
      sql`
    (${t.state} = 'pending' and ${t.issuedAt} is null and ${t.cancelledAt} is null and ${t.deliveryOutcome} = 'not_attempted')
    or (${t.state} = 'issued' and ${t.issuedAt} is not null and ${t.deliveryOutcome} in ('not_attempted','acknowledged'))
    or (${t.state} = 'uncertain' and ${t.deliveryOutcome} in ('unknown','acknowledged'))
    or (${t.state} = 'cancelled' and ${t.cancelledAt} is not null and ${t.issuedAt} is null and ${t.deliveryOutcome} = 'not_attempted')
    or (${t.state} = 'expired' and ${t.issuedAt} is null and ${t.cancelledAt} is null and ${t.deliveryOutcome} = 'not_attempted' and ${t.updatedAt} >= ${t.expiresAt})`,
    ),
    check(
      "dispatch_grants_time_check",
      sql`${sql.join([t.createdAt, t.updatedAt, t.expiresAt, t.issuedAt, t.cancelledAt].map(finite), sql` and `)}
    and ${t.updatedAt} >= ${t.createdAt} and ${factTime(t.issuedAt, t.createdAt, t.updatedAt)} and ${factTime(t.cancelledAt, t.createdAt, t.updatedAt)}
    and (${t.issuedAt} is null or (${t.issuedAt} < ${t.expiresAt} and (${t.cancelledAt} is null or ${t.cancelledAt} >= ${t.issuedAt})))`,
    ),
  ],
);

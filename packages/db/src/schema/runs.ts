import { sql } from "drizzle-orm";
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
import { membership } from "./identity";

const statuses = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
const effects = ["no_effect", "known", "uncertain"] as const;
const errors = [
  "invalid_input",
  "unsupported",
  "malformed_output",
  "out_of_order",
  "output_limit",
  "tool_denied",
  "tool_failed",
  "outcome_uncertain",
  "deadline",
  "adapter_failed",
] as const;
const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

// Canonical input is private text. Its exact versioned tuple/producer validation belongs to the service.
export const runs = zetta.table(
  "runs",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict", onUpdate: "restrict" }),
    requestKey: uuid("request_key").notNull(),
    originKind: text("origin_kind", { enum: ["interactive", "setup"] }).notNull(),
    botId: text("bot_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    configurationId: text("configuration_id").notNull(),
    configurationVersion: integer("configuration_version").notNull(),
    inputVersion: integer("input_version").notNull(),
    inputSnapshot: text("input_snapshot").notNull(),
    producerKind: text("producer_kind", { enum: ["fixture"] }),
    producerVersion: integer("producer_version"),
    actorActivationRevision: integer("actor_activation_revision"),
    createdAt: instant("created_at").notNull(),
    revision: integer("revision").notNull(),
    status: text("status", { enum: statuses }).notNull(),
    currentGeneration: integer("current_generation").notNull(),
    cancelRequestedAt: instant("cancel_requested_at"),
    startedAt: instant("started_at"),
    finishedAt: instant("finished_at"),
  },
  (table) => [
    unique("runs_owner_request_unique").on(table.ownerUserId, table.requestKey),
    unique("runs_id_owner_unique").on(table.id, table.ownerUserId),
    index("runs_owner_id_idx").on(table.ownerUserId, table.id),
    check(
      "runs_identifiers_check",
      sql`${table.ownerUserId} collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'
    and ${table.botId} collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$' and ${table.conversationId} collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'
    and ${table.configurationId} collate "C" ~ '^[a-zA-Z0-9_-]{1,128}$'`,
    ),
    check("runs_origin_check", sql`${table.originKind} in ('interactive','setup')`),
    check(
      "runs_counters_check",
      sql`${table.configurationVersion} between 1 and 2147483647 and ${table.revision} between 1 and 2147483647 and ${table.currentGeneration} between 1 and 2147483647`,
    ),
    check(
      "runs_input_check",
      sql`${table.inputVersion} = 1 and octet_length(${table.inputSnapshot}) between 1 and 98304 and ${table.inputSnapshot} is json array`,
    ),
    check(
      "runs_producer_check",
      sql`(${table.producerKind} is null and ${table.producerVersion} is null and ${table.actorActivationRevision} is null)
    or (${table.producerKind} is not null and ${table.producerVersion} is not null and ${table.actorActivationRevision} is not null
      and ${table.producerKind} = 'fixture' and ${table.producerVersion} = 1 and ${table.actorActivationRevision} between 1 and 2147483647)`,
    ),
    check(
      "runs_status_check",
      sql`${table.status} in ('queued','running','succeeded','failed','cancelled','interrupted')`,
    ),
    check(
      "runs_lifecycle_check",
      sql`
    (${table.status} = 'queued' and ${table.startedAt} is null and ${table.finishedAt} is null and ${table.cancelRequestedAt} is null)
    or (${table.status} = 'running' and ${table.finishedAt} is null)
    or (${table.status} in ('succeeded','failed','cancelled','interrupted') and ${table.finishedAt} is not null)`,
    ),
    check(
      "runs_time_check",
      sql`(${table.startedAt} is null or ${table.startedAt} >= ${table.createdAt})
    and (${table.cancelRequestedAt} is null or ${table.cancelRequestedAt} >= ${table.createdAt})
    and (${table.finishedAt} is null or (${table.finishedAt} >= ${table.createdAt}
      and (${table.startedAt} is null or ${table.finishedAt} >= ${table.startedAt})
      and (${table.cancelRequestedAt} is null or ${table.finishedAt} >= ${table.cancelRequestedAt})))`,
    ),
  ],
);

export const runAttempts = zetta.table(
  "run_attempts",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    generation: integer("generation").notNull(),
    createdAt: instant("created_at").notNull(),
    status: text("status", { enum: statuses }).notNull(),
    effectState: text("effect_state", { enum: effects }).notNull(),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: instant("lease_expires_at"),
    claimedAt: instant("claimed_at"),
    startedAt: instant("started_at"),
    finishedAt: instant("finished_at"),
    stopConfirmedAt: instant("stop_confirmed_at"),
    resultVersion: integer("result_version"),
    resultText: text("result_text"),
    resultErrorCode: text("result_error_code", { enum: errors }),
    resultLastSequence: integer("result_last_sequence"),
    cancellationReason: text("cancellation_reason", { enum: ["owner_requested"] }),
  },
  (table) => [
    index("run_attempts_run_id_owner_user_id_idx").on(table.runId, table.ownerUserId),
    unique("run_attempts_run_generation_unique").on(table.runId, table.generation),
    unique("run_attempts_id_run_owner_unique").on(table.id, table.runId, table.ownerUserId),
    foreignKey({
      name: "run_attempts_owner_fk",
      columns: [table.runId, table.ownerUserId],
      foreignColumns: [runs.id, runs.ownerUserId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check("run_attempts_generation_check", sql`${table.generation} between 1 and 2147483647`),
    check(
      "run_attempts_status_check",
      sql`${table.status} in ('queued','running','succeeded','failed','cancelled','interrupted')`,
    ),
    check(
      "run_attempts_effect_check",
      sql`${table.effectState} in ('no_effect','known','uncertain')`,
    ),
    check(
      "run_attempts_lease_check",
      sql`(${table.leaseId} is null and ${table.leaseExpiresAt} is null and ${table.claimedAt} is null)
    or (${table.leaseId} is not null and ${table.leaseExpiresAt} is not null and ${table.claimedAt} is not null and ${table.leaseExpiresAt} > ${table.claimedAt})`,
    ),
    check(
      "run_attempts_lifecycle_check",
      sql`
    (${table.status} = 'queued' and ${table.effectState} = 'no_effect' and ${table.leaseId} is null and ${table.startedAt} is null
      and ${table.finishedAt} is null and ${table.stopConfirmedAt} is null and ${table.resultVersion} is null and ${table.cancellationReason} is null)
    or (${table.status} = 'running' and ${table.effectState} in ('no_effect','uncertain') and ${table.leaseId} is not null
      and ${table.finishedAt} is null and ${table.resultVersion} is null)
    or (${table.status} in ('succeeded','failed','cancelled','interrupted') and ${table.finishedAt} is not null)`,
    ),
    check(
      "run_attempts_result_check",
      sql`(${table.resultVersion} is null and ${table.resultText} is null and ${table.resultErrorCode} is null and ${table.resultLastSequence} is null)
    or (${table.resultVersion} is not null and ${table.resultVersion} = 1 and ${table.resultText} is not null and octet_length(${table.resultText}) <= 65536
      and ${table.resultLastSequence} is not null and ${table.resultLastSequence} between 0 and 1000)`,
    ),
    check(
      "run_attempts_error_check",
      sql`${table.resultErrorCode} is null or ${table.resultErrorCode} in
    ('invalid_input','unsupported','malformed_output','out_of_order','output_limit','tool_denied','tool_failed','outcome_uncertain','deadline','adapter_failed')`,
    ),
    check(
      "run_attempts_cancellation_check",
      sql`${table.cancellationReason} is null or (${table.cancellationReason} = 'owner_requested' and ${table.status} in ('running','cancelled'))`,
    ),
    check(
      "run_attempts_time_check",
      sql`(${table.claimedAt} is null or ${table.claimedAt} >= ${table.createdAt})
    and (${table.startedAt} is null or (${table.claimedAt} is not null and ${table.startedAt} >= ${table.claimedAt}))
    and (${table.finishedAt} is null or (${table.finishedAt} >= ${table.createdAt}
      and (${table.claimedAt} is null or ${table.finishedAt} >= ${table.claimedAt})
      and (${table.startedAt} is null or ${table.finishedAt} >= ${table.startedAt})))
    and (${table.stopConfirmedAt} is null or (${table.stopConfirmedAt} >= ${table.createdAt}
      and (${table.claimedAt} is null or ${table.stopConfirmedAt} >= ${table.claimedAt})
      and (${table.startedAt} is null or ${table.stopConfirmedAt} >= ${table.startedAt})))`,
    ),
  ],
);

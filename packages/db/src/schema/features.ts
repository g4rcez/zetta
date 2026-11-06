import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot, conversation, message } from "./chat";
import { connection } from "./connections";
import { discussion } from "./discussions";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;
const owner = () =>
  text("owner_user_id")
    .notNull()
    .references(() => user.id, restrict);
const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** Pre-model hooks: add_context | redact | stop | background (start an owned background chat task). */
export const hook = zetta.table(
  "hook",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    kind: text("kind", { enum: ["add_context", "redact", "stop", "background"] }).notNull(),
    pattern: text("pattern").default("").notNull(),
    value: text("value").default("").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: created(),
  },
  (t) => [index("hook_owner_user_id_idx").on(t.ownerUserId), index("hook_bot_idx").on(t.botId)],
);

export const routine = zetta.table(
  "routine",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    timezone: text("timezone").default("UTC").notNull(),
    dailyAt: text("daily_at"),
    everyMinutes: integer("every_minutes"),
    kind: text("kind", { enum: ["recurring", "once"] })
      .default("recurring")
      .notNull(),
    conversationMode: text("conversation_mode", { enum: ["new", "continue"] })
      .default("new")
      .notNull(),
    version: integer("version").default(1).notNull(),
    archived: boolean("archived").default(false).notNull(),
    workflowId: uuid("workflow_id").references(() => workflow.id, setNull),
    onceAt: timestamp("once_at", { withTimezone: true }),
    paused: boolean("paused").default(true).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    // Where the routine is in its life, kept in the database so a restart (or a bot) can tell what to continue:
    // paused (not scheduled), scheduled (waiting for nextRunAt), running, failed/interrupted (needs a re-run), blocked (needs a person), completed (one-time routine done).
    status: text("status", {
      enum: ["paused", "scheduled", "running", "failed", "interrupted", "blocked", "completed"],
    })
      .default("paused")
      .notNull(),
    statusReason: text("status_reason"),
    statusAt: timestamp("status_at", { withTimezone: true }).defaultNow().notNull(),
    /** The room whose bot proposed this routine. While the routine is active, the room is not idle: its work happens in the routine's chat. */
    originDiscussionId: uuid("origin_discussion_id").references(() => discussion.id, setNull),
    createdAt: created(),
  },
  (t) => [
    index("routine_origin_discussion_id_idx").on(t.originDiscussionId),
    index("routine_workflow_id_idx").on(t.workflowId),
    index("routine_owner_user_id_idx").on(t.ownerUserId),
    index("routine_bot_id_idx").on(t.botId),
    index("routine_due_idx").on(t.paused, t.nextRunAt),
  ],
);

/**
 * An extra way to start a routine, next to its schedule. `webhook`: a POST to the trigger's URL with its secret. `gmail` and
 * `home_assistant`: polled by the worker (`cursor` remembers where it stopped, so the first poll fires nothing). `filter` is a Gmail search
 * query or a Home Assistant entity, per kind. Only the hash of a webhook secret is kept.
 */
export const routineTrigger = zetta.table(
  "routine_trigger",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routine.id, restrict),
    ownerUserId: owner(),
    kind: text("kind", { enum: ["webhook", "gmail", "home_assistant"] }).notNull(),
    secretHash: text("secret_hash"),
    filter: jsonb("filter").default({}).notNull(),
    cursor: jsonb("cursor"),
    status: text("status", { enum: ["active", "paused", "failing"] })
      .default("active")
      .notNull(),
    statusReason: text("status_reason"),
    /** Polls that failed in a row. At 5 the trigger becomes `failing` and the owner gets an attention card. */
    failures: integer("failures").default(0).notNull(),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index("routine_trigger_routine_id_idx").on(t.routineId),
    index("routine_trigger_owner_user_id_idx").on(t.ownerUserId),
    index("routine_trigger_poll_idx")
      .on(t.nextPollAt)
      .where(sql`${t.status} = 'active' and ${t.kind} <> 'webhook'`),
  ],
);

export const routineRun = zetta.table(
  "routine_run",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routine.id, restrict),
    ownerUserId: owner(),
    status: text("status", {
      enum: ["running", "succeeded", "failed", "skipped", "blocked", "interrupted"],
    }).notNull(),
    reasonCode: text("reason_code"),
    output: text("output").notNull(),
    conversationId: uuid("conversation_id").references(() => conversation.id, restrict),
    // Unique per (routine, scheduled instant) or per run-now request, so a crash/retry/second worker never repeats an occurrence.
    occurrenceKey: text("occurrence_key"),
    trigger: text("trigger", { enum: ["schedule", "manual", "recovery", "webhook", "event"] })
      .default("schedule")
      .notNull(),
    /** The trigger that started a `webhook` or `event` run. */
    triggerId: uuid("trigger_id").references(() => routineTrigger.id, setNull),
    /** What started a `webhook` or `event` run: the webhook body, a new mail, a state change. Outside data, cut to 16 KB. */
    event: jsonb("event"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** 0 for the scheduled run, then 1, 2, … for each retry of it. */
    attempt: integer("attempt").default(0).notNull(),
    /** A failed run with this set in the future is waiting to be retried; the sweep runs it when due. */
    retryAt: timestamp("retry_at", { withTimezone: true }),
    /** When the owner opened the run's chat. Null = pending (running) or not seen yet: it counts in the Routines badge. */
    readAt: timestamp("read_at", { withTimezone: true }),
    /** The server instance running this row (see server_instance). Recovery leaves the rows of a live instance alone. */
    ownerInstance: uuid("owner_instance"),
  },
  (t) => [
    index("routine_run_unread_idx")
      .on(t.ownerUserId)
      .where(sql`${t.readAt} is null`),
    index("routine_run_owner_user_id_idx").on(t.ownerUserId),
    index("routine_run_conversation_id_idx").on(t.conversationId),
    index("routine_run_trigger_id_idx").on(t.triggerId, t.startedAt),
    index("routine_run_routine_idx").on(t.routineId, t.startedAt),
    index("routine_run_started_idx").on(t.startedAt),
    index("routine_run_retry_idx")
      .on(t.retryAt)
      .where(sql`${t.status} = 'failed'`),
    uniqueIndex("routine_run_occurrence")
      .on(t.routineId, t.occurrenceKey)
      .where(sql`${t.occurrenceKey} is not null`),
  ],
);

/** Attention is separate from execution state: acknowledging never marks a run successful. */
export const attentionItem = zetta.table(
  "attention_item",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    botId: uuid("bot_id").references(() => bot.id, restrict),
    title: text("title").notNull(),
    detail: text("detail").default("").notNull(),
    nextAction: text("next_action").default("").notNull(),
    resultLink: text("result_link"),
    source: text("source", { enum: ["routine", "workflow", "manual", "bot"] })
      .default("manual")
      .notNull(),
    status: text("status", { enum: ["open", "acknowledged", "resolved", "cancelled"] })
      .default("open")
      .notNull(),
    // One live card per (owner, sourceKey): a repeating failure bumps `occurrences` instead of creating duplicates.
    sourceKey: text("source_key"),
    occurrences: integer("occurrences").default(1).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    completed: text("completed").default("").notNull(),
    remaining: text("remaining").default("").notNull(),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("attention_item_bot_id_idx").on(t.botId),
    index("attention_owner_idx").on(t.ownerUserId, t.status),
    uniqueIndex("attention_live_source")
      .on(t.ownerUserId, t.sourceKey)
      .where(sql`${t.sourceKey} is not null and ${t.status} in ('open', 'acknowledged')`),
  ],
);

export const workflow = zetta.table(
  "workflow",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    name: text("name").notNull(),
    graph: jsonb("graph").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: created(),
  },
  (t) => [index("workflow_owner_idx").on(t.ownerUserId)],
);

/** Immutable published versions: a run always points at the exact graph it executed. */
export const workflowVersion = zetta.table(
  "workflow_version",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id, restrict),
    version: integer("version").notNull(),
    graph: jsonb("graph").notNull(),
    createdAt: created(),
  },
  (t) => [unique("workflow_version_unique").on(t.workflowId, t.version)],
);

export const workflowRun = zetta.table(
  "workflow_run",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id, restrict),
    ownerUserId: owner(),
    workflowVersion: integer("workflow_version").notNull(),
    status: text("status", {
      enum: ["running", "succeeded", "failed", "interrupted", "cancelled"],
    }).notNull(),
    trace: jsonb("trace").notNull(),
    requestKey: text("request_key"),
    createdAt: created(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** The server instance running this row (see server_instance). Recovery leaves the rows of a live instance alone. */
    ownerInstance: uuid("owner_instance"),
  },
  (t) => [
    index("workflow_run_owner_user_id_idx").on(t.ownerUserId),
    index("workflow_run_idx").on(t.workflowId, t.createdAt),
    uniqueIndex("workflow_run_request")
      .on(t.workflowId, t.requestKey)
      .where(sql`${t.requestKey} is not null`),
  ],
);

/** Immutable, team-readable copy of a conversation at publication time. */
export const snapshot = zetta.table(
  "snapshot",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    title: text("title").notNull(),
    botName: text("bot_name").notNull(),
    content: jsonb("content").notNull(),
    contentHash: text("content_hash").notNull().default(""),
    requestKey: text("request_key"),
    sourceConversationId: uuid("source_conversation_id").references(() => conversation.id, setNull),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index("snapshot_source_conversation_id_idx").on(t.sourceConversationId),
    uniqueIndex("snapshot_request")
      .on(t.ownerUserId, t.requestKey)
      .where(sql`${t.requestKey} is not null`),
  ],
);

export const reaction = zetta.table(
  "reaction",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, restrict),
    ownerUserId: owner(),
    emoji: text("emoji").notNull(),
    createdAt: created(),
  },
  (t) => [
    index("reaction_owner_user_id_idx").on(t.ownerUserId),
    unique("reaction_unique").on(t.messageId, t.ownerUserId, t.emoji),
  ],
);

/** Attachments owned by one user; linked to a message when sent. Text (<=256KB) lives in `content`; images (<=10MB) live on disk under `path` (relative to the attachments root) and are never deleted. */
export const attachment = zetta.table(
  "attachment",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    conversationId: uuid("conversation_id").references(() => conversation.id, restrict),
    messageId: uuid("message_id").references(() => message.id, restrict),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    content: text("content").notNull().default(""),
    path: text("path"),
    createdAt: created(),
  },
  (t) => [
    index("attachment_conversation_id_idx").on(t.conversationId),
    index("attachment_message_id_idx").on(t.messageId),
    index("attachment_owner_idx").on(t.ownerUserId, t.conversationId),
  ],
);

/** Bot-proposed configuration changes. Nothing is applied until the owner approves the exact diff. */
export const configProposal = zetta.table(
  "config_proposal",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    kind: text("kind", {
      enum: [
        "config",
        "create_bot",
        "create_routine",
        "create_workflow",
        "create_vm",
        "open_discussion",
        "discussion_brief",
        "start_loop",
        "team_goals",
        "bot_permission",
        "create_memory_item",
        "install_skills",
        "chief_action",
        "bot_action",
      ],
    })
      .default("config")
      .notNull(),
    botId: uuid("bot_id").references(() => bot.id, restrict),
    proposedByBotId: uuid("proposed_by_bot_id").references(() => bot.id, restrict),
    baseVersion: integer("base_version").notNull(),
    baseHash: text("base_hash").notNull().default(""),
    patch: jsonb("patch").notNull(),
    diff: jsonb("diff").notNull(),
    // "expired": nobody decided before `expiresAt`; the sweeper closes it like a rejection, and it can no longer be approved.
    status: text("status", { enum: ["pending", "approved", "rejected", "stale", "expired"] })
      .default("pending")
      .notNull(),
    createdAt: created(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** A card nobody decides stops waiting after this. Set by the database, so every place that creates a card gets the same deadline. */
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .default(sql`now() + interval '24 hours'`)
      .notNull(),
  },
  (t) => [
    index("config_proposal_pending_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
    index("config_proposal_proposed_by_bot_id_idx").on(t.proposedByBotId),
    index("config_proposal_bot_id_idx").on(t.botId),
    index("config_proposal_owner_idx").on(t.ownerUserId, t.status),
  ],
);

/** One delegated bot answer inside a user turn (mention-based specialist dispatch) with its outcome. */
export const delegation = zetta.table(
  "delegation",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, restrict),
    parentMessageId: uuid("parent_message_id")
      .notNull()
      .references(() => message.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    status: text("status", { enum: ["running", "succeeded", "failed", "cancelled"] }).notNull(),
    resultMessageId: uuid("result_message_id").references(() => message.id, setNull),
    reasonCode: text("reason_code"),
    createdAt: created(),
  },
  (t) => [
    index("delegation_result_message_id_idx").on(t.resultMessageId),
    index("delegation_parent_message_id_idx").on(t.parentMessageId),
    index("delegation_bot_id_idx").on(t.botId),
    index("delegation_owner_user_id_idx").on(t.ownerUserId),
    index("delegation_conv_idx").on(t.conversationId, t.parentMessageId),
  ],
);

/** Per-bot decision routing with the builtin Laya model: the options map to bounded actions. */
export const decisionConfig = zetta.table(
  "decision_config",
  {
    botId: uuid("bot_id")
      .primaryKey()
      .references(() => bot.id, restrict),
    ownerUserId: owner(),
    enabled: boolean("enabled").default(false).notNull(),
    // laya = builtin local model (default, free). jev = Typesafe hosted API, only with the owner's own connection; the message text is sent to that provider.
    backend: text("backend", { enum: ["laya", "jev"] })
      .default("laya")
      .notNull(),
    question: text("question").notNull(),
    options: jsonb("options")
      .$type<
        {
          label: string;
          description: string;
          action: "respond" | "ask_user" | "delegate" | "stop";
          targetBotId?: string;
          reply?: string;
        }[]
      >()
      .notNull(),
    minConfidence: integer("min_confidence_pct").default(50).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("decision_config_owner_user_id_idx").on(t.ownerUserId)],
);

/** Which of the user's connections a bot uses for each required key. References only; secrets stay in the sealed connection store. */
export const botConnection = zetta.table(
  "bot_connection",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    ownerUserId: owner(),
    key: text("key").notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connection.id, restrict),
    createdAt: created(),
  },
  (t) => [
    index("bot_connection_connection_id_idx").on(t.connectionId),
    index("bot_connection_owner_user_id_idx").on(t.ownerUserId),
    unique("bot_connection_unique").on(t.botId, t.ownerUserId, t.key),
  ],
);

/** Isolated browser profiles per user: dedicated to one bot or explicitly shared among the same user's bots. */
export const browserProfile = zetta.table(
  "browser_profile",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    name: text("name").notNull(),
    mode: text("mode", { enum: ["dedicated", "shared"] })
      .default("shared")
      .notNull(),
    botId: uuid("bot_id").references(() => bot.id, restrict),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    resetAt: timestamp("reset_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index("browser_profile_bot_id_idx").on(t.botId),
    unique("browser_profile_unique").on(t.ownerUserId, t.name),
  ],
);

/** Persistent Linux desktops ("VMs"): one default per user, plus extras a bot proposed and the user approved. Home lives on volume `zetta-vm-<id>`. */
/** Where a computer runs: a container ("vm") or the desktop of the machine that runs the server ("local"). */
export const computerTargets = ["vm", "local", "cua"] as const;
/** The automation tool that drives it. */
export const computerDrivers = ["cua", "agent-desktop"] as const;
/** The system a container computer runs. Only what can run in a container is stored; Windows and macOS are offered in the list but not creatable. */
export const computerOsList = ["debian", "ubuntu"] as const;
export const computerVm = zetta.table(
  "computer_vm",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["default", "extra"] }).notNull(),
    target: text("target", { enum: computerTargets }).default("vm").notNull(),
    driver: text("driver", { enum: computerDrivers }).default("cua").notNull(),
    os: text("os", { enum: computerOsList }).default("debian").notNull(),
    createdByBotId: uuid("created_by_bot_id").references(() => bot.id, restrict),
    purpose: text("purpose"),
    status: text("status", { enum: ["stopped", "running", "failed", "deleted"] })
      .default("stopped")
      .notNull(),
    createdAt: created(),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** The server instance running this row (see server_instance). Recovery leaves the rows of a live instance alone. */
    ownerInstance: uuid("owner_instance"),
    /** Target "cua": the https address of a machine that already runs cua-spacesd. The bearer token is a sealed `connection`, never a column. */
    endpoint: text("endpoint"),
    connectionId: uuid("connection_id").references(() => connection.id, restrict),
  },
  (t) => [
    check(
      "computer_vm_cua_check",
      sql`(${t.target} = 'cua') = (${t.endpoint} is not null and ${t.connectionId} is not null)`,
    ),
    index("computer_vm_connection_id_idx").on(t.connectionId),
    index("computer_vm_created_by_bot_id_idx").on(t.createdByBotId),
    index("computer_vm_owner_idx").on(t.ownerUserId, t.status),
    uniqueIndex("computer_vm_default_unique")
      .on(t.ownerUserId)
      .where(sql`${t.kind} = 'default' and ${t.status} <> 'deleted'`),
    // One computer per user on the server's own desktop: there is one screen and one set of signed-in apps.
    uniqueIndex("computer_vm_local_unique")
      .on(t.ownerUserId)
      .where(sql`${t.target} = 'local' and ${t.status} <> 'deleted'`),
  ],
);

export const machineKinds = ["ssh", "sftp", "ftp"] as const;
/** A remote machine a bot reaches through the server (never from the bot's own shell). The key, password or token is a sealed `connection`; this row holds no secret. */
export const machine = zetta.table(
  "machine",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    name: text("name").notNull(),
    kind: text("kind", { enum: machineKinds }).notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    username: text("username").notNull(),
    /** ssh and sftp: the pinned host key, `<type> <base64>` as `ssh-keyscan` prints it. A different key later fails the call. */
    hostKey: text("host_key"),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connection.id, restrict),
    createdAt: created(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("machine_port_check", sql`${t.port} between 1 and 65535`),
    check("machine_host_key_check", sql`${t.kind} = 'ftp' or ${t.hostKey} is not null`),
    index("machine_connection_id_idx").on(t.connectionId),
    uniqueIndex("machine_owner_name_unique")
      .on(t.ownerUserId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Which bots may use a machine. A machine nobody is listed for is used by no bot. A row goes when the machine or the bot does. */
export const machineBot = zetta.table(
  "machine_bot",
  {
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machine.id, { onDelete: "cascade", onUpdate: "restrict" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, { onDelete: "cascade", onUpdate: "restrict" }),
    ownerUserId: owner(),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.machineId, t.botId] }),
    index("machine_bot_bot_id_idx").on(t.botId),
    index("machine_bot_owner_idx").on(t.ownerUserId),
  ],
);

/** Privacy-safe activity trail: closed reason codes, ids and counts only. No prompts, outputs, URLs, secrets or provider errors. */
export const auditEvent = zetta.table(
  "audit_event",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    kind: text("kind", {
      enum: [
        "harness_run",
        "tool_call",
        "approval",
        "browser_action",
        "routine_run",
        "workflow_run",
        "decision",
        "connection",
      ],
    }).notNull(),
    outcome: text("outcome", {
      enum: [
        "ok",
        "failed",
        "denied",
        "cancelled",
        "timeout",
        "busy",
        "auth_required",
        "not_installed",
      ],
    }).notNull(),
    botId: uuid("bot_id"),
    subjectId: text("subject_id"),
    detail: text("detail"),
    // Token counts of a harness run (all its processes added up). Null when the harness does not report them.
    inputTokens: integer("input_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: created(),
  },
  (t) => [
    index("audit_owner_idx").on(t.ownerUserId, t.createdAt),
    // The last harness run of each bot (bot status): without it the query reads the owner's whole audit history.
    index("audit_harness_run_last_idx")
      .on(t.ownerUserId, t.botId, t.createdAt.desc())
      .where(sql`${t.kind} = 'harness_run'`),
  ],
);

/** User-owned MCP servers (http, or allowlisted local stdio commands). Secrets never live here: an optional connection id references the sealed store. */
export const mcpServer = zetta.table(
  "mcp_server",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    name: text("name").notNull(),
    transport: text("transport", { enum: ["http", "stdio"] }).notNull(),
    url: text("url"),
    command: text("command"),
    args: jsonb("args").$type<string[]>().default([]).notNull(),
    connectionId: uuid("connection_id").references(() => connection.id, setNull),
    /**
     * Whose configuration this is. `private`: only its owner uses it. `team`: the workspace's own configuration, created and edited by
     * the administrator and used with every tool by all members' bots (its secret stays sealed under the owner).
     */
    sharing: text("sharing", { enum: ["private", "team"] })
      .default("private")
      .notNull(),
    /** Tool catalogue seen at the last listing (remote MCP servers only; native plugins read theirs from the registry). */
    tools: jsonb("tools").$type<{ name: string; description: string }[]>().default([]).notNull(),
    createdAt: created(),
  },
  (t) => [
    index("mcp_server_connection_id_idx").on(t.connectionId),
    // A user may hold a private and a team configuration of the same plugin; the workspace has one team configuration per plugin.
    unique("mcp_server_owner_name").on(t.ownerUserId, t.name, t.sharing),
    uniqueIndex("mcp_server_team_name")
      .on(t.name)
      .where(sql`${t.sharing} = 'team'`),
  ],
);

/** Which of a user's MCP servers a bot may use (per user: sharing a bot never shares servers). */
export const botIntegration = zetta.table(
  "bot_integration",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    ownerUserId: owner(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => mcpServer.id, restrict),
    /** `all`: every tool of the server. `selected`: only the names in `allowedTools`. */
    toolsMode: text("tools_mode", { enum: ["all", "selected"] })
      .default("all")
      .notNull(),
    allowedTools: jsonb("allowed_tools").$type<string[]>().default([]).notNull(),
    createdAt: created(),
  },
  (t) => [
    index("bot_integration_owner_user_id_idx").on(t.ownerUserId),
    index("bot_integration_server_id_idx").on(t.serverId),
    unique("bot_integration_unique").on(t.botId, t.ownerUserId, t.serverId),
  ],
);

/** Public web/RSS sources a user follows for briefings (read through the SSRF-guarded fetcher or the isolated browser). */
export const source = zetta.table(
  "source",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    kind: text("kind", { enum: ["rss", "web", "email", "x"] }).notNull(),
    url: text("url").notNull(),
    label: text("label").notNull(),
    // email/x: the owner's sealed connection that authenticates the read, plus non-secret settings (host, mailbox, query...).
    connectionId: uuid("connection_id").references(() => connection.id, setNull),
    config: jsonb("config").$type<Record<string, string | number>>(),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastStatus: text("last_status", { enum: ["ok", "failed", "blocked"] }),
    createdAt: created(),
  },
  (t) => [
    index("source_connection_id_idx").on(t.connectionId),
    unique("source_owner_url").on(t.ownerUserId, t.url),
  ],
);

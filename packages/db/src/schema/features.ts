import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { bot, conversation, message } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const owner = () => text("owner_user_id").notNull().references(() => user.id, restrict);
const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** Persistent facts, per user, optionally scoped to one bot. Never shared across users. */
export const memory = pgTable("memory", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), botId: uuid("bot_id").references(() => bot.id, restrict),
  // Hermes-style stores: "user" = profile of the person (shared by their bots), "memory" = this bot's own notes about working for them.
  target: text("target", { enum: ["user", "memory"] }).default("memory").notNull(),
  content: text("content").notNull(), category: text("category", { enum: ["fact", "preference", "decision", "correction"] }).default("fact").notNull(),
  version: integer("version").default(1).notNull(), contentHash: text("content_hash").notNull().default(""), source: text("source", { enum: ["user", "bot", "chat"] }).default("user").notNull(),
  createdAt: created(),
}, (t) => [index("memory_owner_idx").on(t.ownerUserId), uniqueIndex("memory_owner_hash").on(t.ownerUserId, t.contentHash).where(sql`${t.contentHash} <> ''`)]);

/** Reusable procedures learned from completed tasks. */
export const instruction = pgTable("instruction", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), title: text("title").notNull(), body: text("body").notNull(), createdAt: created(),
  trigger: text("trigger").default("").notNull(), verification: text("verification").default("").notNull(), version: integer("version").default(1).notNull(), archived: boolean("archived").default(false).notNull(),
  contentHash: text("content_hash").notNull().default(""),
}, (t) => [index("instruction_owner_idx").on(t.ownerUserId), uniqueIndex("instruction_owner_hash").on(t.ownerUserId, t.contentHash).where(sql`${t.contentHash} <> ''`)]);

/** Pre-model hooks: add_context | redact | stop | background (start an owned background chat task). */
export const hook = pgTable("hook", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), botId: uuid("bot_id").notNull().references(() => bot.id, restrict),
  kind: text("kind", { enum: ["add_context", "redact", "stop", "background"] }).notNull(),
  pattern: text("pattern").default("").notNull(), value: text("value").default("").notNull(), enabled: boolean("enabled").default(true).notNull(), position: integer("position").default(0).notNull(), createdAt: created(),
}, (t) => [index("hook_bot_idx").on(t.botId)]);

export const routine = pgTable("routine", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), botId: uuid("bot_id").notNull().references(() => bot.id, restrict),
  title: text("title").notNull(), prompt: text("prompt").notNull(),
  timezone: text("timezone").default("UTC").notNull(), dailyAt: text("daily_at"), everyMinutes: integer("every_minutes"),
  kind: text("kind", { enum: ["recurring", "once"] }).default("recurring").notNull(), conversationMode: text("conversation_mode", { enum: ["new", "continue"] }).default("new").notNull(),
  version: integer("version").default(1).notNull(), archived: boolean("archived").default(false).notNull(), workflowId: uuid("workflow_id"), onceAt: timestamp("once_at", { withTimezone: true }),
  paused: boolean("paused").default(true).notNull(), nextRunAt: timestamp("next_run_at", { withTimezone: true }), lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: created(),
}, (t) => [index("routine_due_idx").on(t.paused, t.nextRunAt)]);

export const routineRun = pgTable("routine_run", {
  id: uuid("id").primaryKey().defaultRandom(), routineId: uuid("routine_id").notNull().references(() => routine.id, restrict), ownerUserId: owner(),
  status: text("status", { enum: ["running", "succeeded", "failed", "skipped", "blocked", "interrupted"] }).notNull(), reasonCode: text("reason_code"), output: text("output").notNull(), conversationId: uuid("conversation_id").references(() => conversation.id, restrict),
  // Unique per (routine, scheduled instant) or per run-now request, so a crash/retry/second worker never repeats an occurrence.
  occurrenceKey: text("occurrence_key"), trigger: text("trigger", { enum: ["schedule", "manual"] }).default("schedule").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(), finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("routine_run_routine_idx").on(t.routineId, t.startedAt), uniqueIndex("routine_run_occurrence").on(t.routineId, t.occurrenceKey).where(sql`${t.occurrenceKey} is not null`)]);

/** Attention is separate from execution state: acknowledging never marks a run successful. */
export const attentionItem = pgTable("attention_item", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), botId: uuid("bot_id").references(() => bot.id, restrict),
  title: text("title").notNull(), detail: text("detail").default("").notNull(), nextAction: text("next_action").default("").notNull(),
  resultLink: text("result_link"), source: text("source", { enum: ["routine", "workflow", "manual", "bot"] }).default("manual").notNull(),
  status: text("status", { enum: ["open", "acknowledged", "resolved", "cancelled"] }).default("open").notNull(),
  // One live card per (owner, sourceKey): a repeating failure bumps `occurrences` instead of creating duplicates.
  sourceKey: text("source_key"), occurrences: integer("occurrences").default(1).notNull(), readAt: timestamp("read_at", { withTimezone: true }), completed: text("completed").default("").notNull(), remaining: text("remaining").default("").notNull(),
  createdAt: created(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("attention_owner_idx").on(t.ownerUserId, t.status), uniqueIndex("attention_live_source").on(t.ownerUserId, t.sourceKey).where(sql`${t.sourceKey} is not null and ${t.status} in ('open', 'acknowledged')`)]);

export const workflow = pgTable("workflow", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), name: text("name").notNull(), graph: jsonb("graph").notNull(), version: integer("version").default(1).notNull(), createdAt: created(),
}, (t) => [index("workflow_owner_idx").on(t.ownerUserId)]);

/** Immutable published versions: a run always points at the exact graph it executed. */
export const workflowVersion = pgTable("workflow_version", {
  id: uuid("id").primaryKey().defaultRandom(), workflowId: uuid("workflow_id").notNull().references(() => workflow.id, restrict), version: integer("version").notNull(),
  graph: jsonb("graph").notNull(), createdAt: created(),
}, (t) => [unique("workflow_version_unique").on(t.workflowId, t.version)]);

export const workflowRun = pgTable("workflow_run", {
  id: uuid("id").primaryKey().defaultRandom(), workflowId: uuid("workflow_id").notNull().references(() => workflow.id, restrict), ownerUserId: owner(),
  workflowVersion: integer("workflow_version").notNull(), status: text("status", { enum: ["running", "succeeded", "failed", "interrupted", "cancelled"] }).notNull(), trace: jsonb("trace").notNull(),
  requestKey: text("request_key"), createdAt: created(), finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("workflow_run_idx").on(t.workflowId, t.createdAt), uniqueIndex("workflow_run_request").on(t.workflowId, t.requestKey).where(sql`${t.requestKey} is not null`)]);

/** Immutable, team-readable copy of a conversation at publication time. */
export const snapshot = pgTable("snapshot", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), title: text("title").notNull(), botName: text("bot_name").notNull(), content: jsonb("content").notNull(), contentHash: text("content_hash").notNull().default(""), requestKey: text("request_key"),
  sourceConversationId: uuid("source_conversation_id"), revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: created(),
}, (t) => [uniqueIndex("snapshot_request").on(t.ownerUserId, t.requestKey).where(sql`${t.requestKey} is not null`)]);

export const reaction = pgTable("reaction", {
  id: uuid("id").primaryKey().defaultRandom(), messageId: uuid("message_id").notNull().references(() => message.id, restrict), ownerUserId: owner(), emoji: text("emoji").notNull(), createdAt: created(),
}, (t) => [unique("reaction_unique").on(t.messageId, t.ownerUserId, t.emoji)]);

/** Text attachments (<=256KB) owned by one user; linked to a message when sent. Binary files are rejected at upload. */
export const attachment = pgTable("attachment", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), conversationId: uuid("conversation_id").references(() => conversation.id, restrict),
  messageId: uuid("message_id").references(() => message.id, restrict), name: text("name").notNull(), mimeType: text("mime_type").notNull(), size: integer("size").notNull(),
  content: text("content").notNull(), createdAt: created(),
}, (t) => [index("attachment_owner_idx").on(t.ownerUserId, t.conversationId)]);

/** Bot-proposed configuration changes. Nothing is applied until the owner approves the exact diff. */
export const configProposal = pgTable("config_proposal", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), kind: text("kind", { enum: ["config", "create_bot", "create_routine", "create_workflow", "create_instruction", "create_vm", "open_discussion", "discussion_brief"] }).default("config").notNull(), botId: uuid("bot_id").references(() => bot.id, restrict),
  proposedByBotId: uuid("proposed_by_bot_id").references(() => bot.id, restrict), baseVersion: integer("base_version").notNull(), baseHash: text("base_hash").notNull().default(""),
  patch: jsonb("patch").notNull(), diff: jsonb("diff").notNull(), status: text("status", { enum: ["pending", "approved", "rejected", "stale"] }).default("pending").notNull(),
  createdAt: created(), decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [index("config_proposal_owner_idx").on(t.ownerUserId, t.status)]);

/** One delegated bot answer inside a user turn (mention-based specialist dispatch) with its outcome. */
export const delegation = pgTable("delegation", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), conversationId: uuid("conversation_id").notNull().references(() => conversation.id, restrict),
  parentMessageId: uuid("parent_message_id").notNull().references(() => message.id, restrict), botId: uuid("bot_id").notNull().references(() => bot.id, restrict),
  status: text("status", { enum: ["running", "succeeded", "failed", "cancelled"] }).notNull(), resultMessageId: uuid("result_message_id"), reasonCode: text("reason_code"), createdAt: created(),
}, (t) => [index("delegation_conv_idx").on(t.conversationId, t.parentMessageId)]);

/** Per-bot decision routing with the builtin Laya model: the options map to bounded actions. */
export const decisionConfig = pgTable("decision_config", {
  botId: uuid("bot_id").primaryKey().references(() => bot.id, restrict), ownerUserId: owner(), enabled: boolean("enabled").default(false).notNull(),
  // laya = builtin local model (default, free). jev = Typesafe hosted API, only with the owner's own connection; the message text is sent to that provider.
  backend: text("backend", { enum: ["laya", "jev"] }).default("laya").notNull(),
  question: text("question").notNull(), options: jsonb("options").$type<{ label: string; description: string; action: "respond" | "ask_user" | "delegate" | "stop"; targetBotId?: string; reply?: string }[]>().notNull(),
  minConfidence: integer("min_confidence_pct").default(50).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Which of the user's connections a bot uses for each required key. References only; secrets stay in the sealed connection store. */
export const botConnection = pgTable("bot_connection", {
  botId: uuid("bot_id").notNull().references(() => bot.id, restrict), ownerUserId: owner(), key: text("key").notNull(), connectionId: text("connection_id").notNull(), createdAt: created(),
}, (t) => [unique("bot_connection_unique").on(t.botId, t.ownerUserId, t.key)]);

/** Isolated browser profiles per user: dedicated to one bot or explicitly shared among the same user's bots. */
export const browserProfile = pgTable("browser_profile", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), name: text("name").notNull(), mode: text("mode", { enum: ["dedicated", "shared"] }).default("shared").notNull(),
  botId: uuid("bot_id").references(() => bot.id, restrict), revokedAt: timestamp("revoked_at", { withTimezone: true }), resetAt: timestamp("reset_at", { withTimezone: true }), createdAt: created(),
}, (t) => [unique("browser_profile_unique").on(t.ownerUserId, t.name)]);

/** Persistent Linux desktops ("VMs"): one default per user, plus extras a bot proposed and the user approved. Home lives on volume `zetta-vm-<id>`. */
export const computerVm = pgTable("computer_vm", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), name: text("name").notNull(), kind: text("kind", { enum: ["default", "extra"] }).notNull(),
  createdByBotId: uuid("created_by_bot_id").references(() => bot.id, restrict), purpose: text("purpose"), status: text("status", { enum: ["stopped", "running", "failed", "deleted"] }).default("stopped").notNull(),
  createdAt: created(), lastStartedAt: timestamp("last_started_at", { withTimezone: true }), deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("computer_vm_owner_idx").on(t.ownerUserId, t.status), uniqueIndex("computer_vm_default_unique").on(t.ownerUserId).where(sql`${t.kind} = 'default' and ${t.status} <> 'deleted'`)]);

/** Privacy-safe activity trail: closed reason codes, ids and counts only. No prompts, outputs, URLs, secrets or provider errors. */
export const auditEvent = pgTable("audit_event", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), kind: text("kind", { enum: ["harness_run", "tool_call", "approval", "browser_action", "routine_run", "workflow_run", "decision", "connection"] }).notNull(),
  outcome: text("outcome", { enum: ["ok", "failed", "denied", "cancelled", "timeout", "busy", "auth_required", "not_installed"] }).notNull(), botId: uuid("bot_id"), subjectId: text("subject_id"), detail: text("detail"), createdAt: created(),
}, (t) => [index("audit_owner_idx").on(t.ownerUserId, t.createdAt)]);

/** User-owned MCP servers (http, or allowlisted local stdio commands). Secrets never live here: an optional connection id references the sealed store. */
export const mcpServer = pgTable("mcp_server", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), name: text("name").notNull(), transport: text("transport", { enum: ["http", "stdio"] }).notNull(),
  url: text("url"), command: text("command"), args: jsonb("args").$type<string[]>().default([]).notNull(), connectionId: text("connection_id"), createdAt: created(),
}, (t) => [unique("mcp_server_owner_name").on(t.ownerUserId, t.name)]);

/** Which of a user's MCP servers a bot may use (per user: sharing a bot never shares servers). */
export const botIntegration = pgTable("bot_integration", {
  botId: uuid("bot_id").notNull().references(() => bot.id, restrict), ownerUserId: owner(), serverId: uuid("server_id").notNull().references(() => mcpServer.id, restrict), createdAt: created(),
}, (t) => [unique("bot_integration_unique").on(t.botId, t.ownerUserId, t.serverId)]);

/** Public web/RSS sources a user follows for briefings (read through the SSRF-guarded fetcher or the isolated browser). */
export const source = pgTable("source", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), kind: text("kind", { enum: ["rss", "web", "email", "x"] }).notNull(), url: text("url").notNull(), label: text("label").notNull(),
  // email/x: the owner's sealed connection that authenticates the read, plus non-secret settings (host, mailbox, query...).
  connectionId: text("connection_id"), config: jsonb("config").$type<Record<string, string | number>>(),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }), lastStatus: text("last_status", { enum: ["ok", "failed", "blocked"] }), createdAt: created(),
}, (t) => [unique("source_owner_url").on(t.ownerUserId, t.url)]);

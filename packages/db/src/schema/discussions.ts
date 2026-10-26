import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { bot, conversation, message } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const owner = () => text("owner_user_id").notNull().references(() => user.id, restrict);
const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** Which bots a bot may open a group discussion with without asking (per user: sharing a bot never shares this list). */
export const botPeer = pgTable("bot_peer", {
  ownerUserId: owner(), botId: uuid("bot_id").notNull().references(() => bot.id, restrict), peerBotId: uuid("peer_bot_id").notNull().references(() => bot.id, restrict), createdAt: created(),
}, (t) => [unique("bot_peer_unique").on(t.ownerUserId, t.botId, t.peerBotId), check("bot_peer_self_check", sql`${t.botId} <> ${t.peerBotId}`)]);

/**
 * A group of bots working on one task. The transcript lives in its own conversation (kind "discussion"); `context` is the shared task
 * brief every member sees. `tainted` = outside content (customers, pages) is in play: code-capable members then need an approved brief.
 */
export const discussion = pgTable("discussion", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(),
  conversationId: uuid("conversation_id").notNull().unique().references(() => conversation.id, restrict),
  createdByBotId: uuid("created_by_bot_id").references(() => bot.id, restrict),
  originConversationId: uuid("origin_conversation_id").references(() => conversation.id, { onDelete: "set null", onUpdate: "restrict" }),
  originMessageId: uuid("origin_message_id").references(() => message.id, { onDelete: "set null", onUpdate: "restrict" }),
  /** The outside chat that started it (inbound): its bot may reply there, and only there. */
  originInbound: jsonb("origin_inbound").$type<{ plugin: string; chat: string; chatName: string }>(),
  title: text("title").notNull(), goal: text("goal").default("").notNull(), context: text("context").default("").notNull(), contextVersion: integer("context_version").default(1).notNull(),
  status: text("status", { enum: ["open", "paused", "stalled", "resolved", "cancelled"] }).default("open").notNull(),
  tainted: boolean("tainted").default(false).notNull(),
  turnBudget: integer("turn_budget").default(20).notNull(), turnsUsed: integer("turns_used").default(0).notNull(),
  summary: text("summary").default("").notNull(),
  /** Same creator + origin + title while open = the same discussion (a bot repeating its open block gets the existing one). */
  openKey: text("open_key").notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: created(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [
  index("discussion_owner_idx").on(t.ownerUserId, t.status),
  uniqueIndex("discussion_open_key").on(t.ownerUserId, t.openKey).where(sql`${t.status} in ('open', 'paused', 'stalled')`),
  check("discussion_title_check", sql`length(btrim(${t.title})) between 1 and 120`),
  check("discussion_context_check", sql`length(${t.context}) <= 8000 and length(${t.goal}) <= 1000`),
  check("discussion_budget_check", sql`${t.turnBudget} between 1 and 50`),
]);

/** A bot in a discussion. `requireApproval`: while tainted, this member only runs after the owner approved the current brief. */
export const discussionMember = pgTable("discussion_member", {
  discussionId: uuid("discussion_id").notNull().references(() => discussion.id, restrict), botId: uuid("bot_id").notNull().references(() => bot.id, restrict),
  role: text("role").default("").notNull(), requireApproval: boolean("require_approval").default(false).notNull(), turns: integer("turns").default(0).notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.discussionId, t.botId] }), check("discussion_member_role_check", sql`length(${t.role}) <= 200`)]);

/** Durable queue of member turns: claimed one at a time per owner, recovered (never silently retried) after a restart. */
export const discussionTurn = pgTable("discussion_turn", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(),
  discussionId: uuid("discussion_id").notNull().references(() => discussion.id, restrict), botId: uuid("bot_id").notNull().references(() => bot.id, restrict),
  /** The post that woke this member (null for wrap-up turns). */
  triggerMessageId: uuid("trigger_message_id"),
  kind: text("kind", { enum: ["reply", "wrapup"] }).default("reply").notNull(),
  status: text("status", { enum: ["queued", "awaiting_approval", "running", "done", "failed", "skipped", "interrupted", "cancelled"] }).default("queued").notNull(),
  approvedContextVersion: integer("approved_context_version"), attempts: integer("attempts").default(0).notNull(),
  reasonCode: text("reason_code"), resultMessageId: uuid("result_message_id"),
  createdAt: created(), claimedAt: timestamp("claimed_at", { withTimezone: true }), finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("discussion_turn_wake_unique").on(t.discussionId, t.botId, t.triggerMessageId, t.kind),
  uniqueIndex("discussion_turn_one_running").on(t.discussionId).where(sql`${t.status} = 'running'`),
  index("discussion_turn_status_idx").on(t.status, t.createdAt),
]);

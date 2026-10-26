import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { bot, conversation, message } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const owner = () => text("owner_user_id").notNull().references(() => user.id, restrict);
const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** A bot that answers a plugin channel (WhatsApp, Telegram...): new outside messages start a turn for it. One bot per plugin install. */
export const inboundRoute = pgTable("inbound_route", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), botId: uuid("bot_id").notNull().references(() => bot.id, restrict),
  pluginId: text("plugin_id").notNull(), enabled: boolean("enabled").default(true).notNull(),
  filter: jsonb("filter").$type<{ direct: boolean; groups: boolean; chats: string[] }>().default({ direct: true, groups: false, chats: [] }).notNull(),
  /** Opaque, owned by the plugin (watermarks); never secrets. */
  cursor: jsonb("cursor"),
  pollEverySeconds: integer("poll_every_seconds").default(60).notNull(),
  nextPollAt: timestamp("next_poll_at", { withTimezone: true }).defaultNow().notNull(), lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastError: text("last_error").default("").notNull(),
  createdAt: created(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique("inbound_route_owner_plugin").on(t.ownerUserId, t.pluginId), index("inbound_route_due_idx").on(t.enabled, t.nextPollAt), check("inbound_route_interval_check", sql`${t.pollEverySeconds} >= 20`)]);

/** One outside chat (a customer, a group) and the conversation its messages go to. */
export const inboundThread = pgTable("inbound_thread", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), routeId: uuid("route_id").notNull().references(() => inboundRoute.id, restrict),
  chatKey: text("chat_key").notNull(), chatName: text("chat_name").default("").notNull(),
  conversationId: uuid("conversation_id").notNull().unique().references(() => conversation.id, restrict),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }), createdAt: created(),
}, (t) => [unique("inbound_thread_chat").on(t.routeId, t.chatKey)]);

/** An outside message seen by the poller. Unique per route and plugin key, so re-polls never deliver twice. Purged a week after delivery. */
export const inboundEvent = pgTable("inbound_event", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(), routeId: uuid("route_id").notNull().references(() => inboundRoute.id, restrict),
  threadId: uuid("thread_id").references(() => inboundThread.id, restrict),
  key: text("key").notNull(), chatKey: text("chat_key").notNull(), fromName: text("from_name").default("").notNull(), text: text("text").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  status: text("status", { enum: ["pending", "delivering", "delivered", "skipped", "failed"] }).default("pending").notNull(),
  messageId: uuid("message_id").references(() => message.id, { onDelete: "set null", onUpdate: "restrict" }), attempts: integer("attempts").default(0).notNull(),
  createdAt: created(),
}, (t) => [unique("inbound_event_key").on(t.routeId, t.key), index("inbound_event_status_idx").on(t.status, t.createdAt), check("inbound_event_text_check", sql`length(${t.text}) <= 2000`)]);

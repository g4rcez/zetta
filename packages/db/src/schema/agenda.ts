import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { bot, conversation } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const owner = () => text("owner_user_id").notNull().references(() => user.id, restrict);
const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/**
 * The user's Agenda: tasks, reminders, events and notes added by the user, by their bots or pulled from Google Calendar.
 * `syncState` drives the two-way Google sync: local edits are `pending_push` until the pusher writes them, and win over pulls meanwhile.
 */
export const agendaItem = pgTable("agenda_item", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner(),
  kind: text("kind", { enum: ["event", "task", "reminder", "note"] }).default("event").notNull(),
  title: text("title").notNull(), description: text("description").default("").notNull(), location: text("location").default("").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(), endAt: timestamp("end_at", { withTimezone: true }), allDay: boolean("all_day").default(false).notNull(),
  timezone: text("timezone").default("UTC").notNull(),
  status: text("status", { enum: ["open", "done", "cancelled"] }).default("open").notNull(),
  remindAt: timestamp("remind_at", { withTimezone: true }), remindedAt: timestamp("reminded_at", { withTimezone: true }),
  source: text("source", { enum: ["user", "bot", "google"] }).default("user").notNull(),
  createdByBotId: uuid("created_by_bot_id").references(() => bot.id, { onDelete: "set null", onUpdate: "restrict" }),
  conversationId: uuid("conversation_id").references(() => conversation.id, { onDelete: "set null", onUpdate: "restrict" }),
  googleEventId: text("google_event_id"), googleEtag: text("google_etag"), syncToGoogle: boolean("sync_to_google").default(false).notNull(),
  syncState: text("sync_state", { enum: ["local", "synced", "pending_push", "pending_delete", "error"] }).default("local").notNull(),
  syncError: text("sync_error").default("").notNull(),
  version: integer("version").default(1).notNull(), archived: boolean("archived").default(false).notNull(),
  createdAt: created(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("agenda_owner_start_idx").on(t.ownerUserId, t.startAt),
  uniqueIndex("agenda_owner_google_event").on(t.ownerUserId, t.googleEventId).where(sql`${t.googleEventId} is not null`),
  index("agenda_remind_idx").on(t.remindedAt, t.remindAt),
  index("agenda_sync_state_idx").on(t.ownerUserId, t.syncState),
]);

/** Per-user Google Calendar sync settings and cursor. */
export const agendaSync = pgTable("agenda_sync", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: owner().unique(),
  enabled: boolean("enabled").default(false).notNull(), pushByDefault: boolean("push_by_default").default(false).notNull(),
  syncToken: text("sync_token"), lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }), lastError: text("last_error").default("").notNull(),
  nextSyncAt: timestamp("next_sync_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: created(),
}, (t) => [index("agenda_sync_due_idx").on(t.enabled, t.nextSyncAt)]);

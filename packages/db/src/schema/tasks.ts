import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { bot, conversation, message } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;

/** The fixed columns of the kanban, shared by every bot of a user. */
export const TASK_STATUSES = ["backlog", "in_progress", "blocked", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A unit of work a bot (or the user) put on the board. It links back to the thread and message it came from; deleting those only unlinks it. */
export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    title: text("title").notNull(),
    description: text("description").default("").notNull(),
    status: text("status", { enum: TASK_STATUSES }).default("backlog").notNull(),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    conversationId: uuid("conversation_id").references(() => conversation.id, setNull),
    messageId: uuid("message_id").references(() => message.id, setNull),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("task_bot_id_idx").on(t.botId),
    index("task_conversation_id_idx").on(t.conversationId),
    index("task_message_id_idx").on(t.messageId),index("task_owner_idx").on(t.ownerUserId, t.status, t.updatedAt)],
);

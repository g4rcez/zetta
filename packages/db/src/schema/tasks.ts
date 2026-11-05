import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot, conversation, message } from "./chat";
import { searchVector } from "./search";
import { team } from "./teams";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;

/** The fixed columns of the kanban, shared by every bot of a user. */
export const TASK_STATUSES = ["backlog", "in_progress", "blocked", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Who must do the task: a bot (the default) or a person. A person task is how a bot asks a human for something. */
export const TASK_ASSIGNEES = ["bot", "person"] as const;
export type TaskAssignee = (typeof TASK_ASSIGNEES)[number];

/**
 * A unit of work a bot (or the user) put on the board. It links back to the thread and message it came from; deleting those only unlinks it.
 * With `assignee = "person"`, `assigneeUserId` is the human who must act, `botId` is the bot that asked, and `teamId` is the team through
 * which a person who is not the owner sees the task (null when the owner is the assignee).
 */
export const task = zetta.table(
  "task",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    title: text("title").notNull(),
    description: text("description").default("").notNull(),
    status: text("status", { enum: TASK_STATUSES }).default("backlog").notNull(),
    priority: text("priority", { enum: TASK_PRIORITIES }).default("none").notNull(),
    labels: text("labels")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    assignee: text("assignee", { enum: TASK_ASSIGNEES }).default("bot").notNull(),
    assigneeUserId: text("assignee_user_id").references(() => user.id, restrict),
    teamId: uuid("team_id").references(() => team.id, setNull),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    conversationId: uuid("conversation_id").references(() => conversation.id, setNull),
    messageId: uuid("message_id").references(() => message.id, setNull),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("task_assignee_check", sql`${t.assignee} = 'bot' or ${t.assigneeUserId} is not null`),
    index("task_assignee_user_idx").on(t.assigneeUserId, t.status),
    index("task_bot_id_idx").on(t.botId),
    index("task_conversation_id_idx").on(t.conversationId),
    index("task_message_id_idx").on(t.messageId),
    index("task_owner_idx").on(t.ownerUserId, t.status, t.updatedAt),
    // memory jobs scan finished tasks of the last day across owners
    index("task_status_updated_idx").on(t.status, t.updatedAt),
    index("task_search_idx").using("gin", searchVector(sql`${t.title} || ' ' || ${t.description}`)),
  ],
);

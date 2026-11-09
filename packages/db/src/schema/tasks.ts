import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot, conversation, message } from "./chat";
import { searchVector } from "./search";
import { team } from "./teams";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;
const cascade = { onDelete: "cascade", onUpdate: "restrict" } as const;

/** The fixed columns of the kanban, shared by every bot of a user. */
export const TASK_STATUSES = ["backlog", "in_progress", "blocked", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Who must do the task: a bot (the default) or a person. A person task is how a bot asks a human for something. */
export const TASK_ASSIGNEES = ["bot", "person"] as const;
export type TaskAssignee = (typeof TASK_ASSIGNEES)[number];

/**
 * Whether the heartbeat (modules/tasks/heartbeat.ts) calls the bot back while the task is open. "auto": it does. "paused": the server
 * stopped it (no progress, repeated failures, the check cap or the user pressing Stop) and `followUpReason` says why. "off": nobody follows it.
 */
export const TASK_FOLLOW_UPS = ["auto", "paused", "off"] as const;
export type TaskFollowUp = (typeof TASK_FOLLOW_UPS)[number];

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
    /** A subtask points at its parent; only one level exists (the store refuses a subtask of a subtask). It goes when its parent goes. */
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => task.id, cascade),
    /** The bot's note on what is done, where it stopped and what comes next. Every follow-up check reads it. */
    progress: text("progress").default("").notNull(),
    followUp: text("follow_up", { enum: TASK_FOLLOW_UPS }).default("off").notNull(),
    followUpReason: text("follow_up_reason"),
    /** When the heartbeat calls the bot back for this task. */
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    /** Follow-up turns taken so far; the heartbeat pauses the task at the cap. */
    checks: integer("checks").default(0).notNull(),
    /** Checks in a row where nothing on the task changed. */
    stalls: integer("stalls").default(0).notNull(),
    /** Failed checks in a row. */
    failures: integer("failures").default(0).notNull(),
    /** The server instance driving this task (see server_instance). Recovery leaves the tasks of a live instance alone. */
    ownerInstance: uuid("owner_instance"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("task_assignee_check", sql`${t.assignee} = 'bot' or ${t.assigneeUserId} is not null`),
    index("task_assignee_user_idx").on(t.assigneeUserId, t.status),
    index("task_bot_id_idx").on(t.botId),
    index("task_conversation_id_idx").on(t.conversationId),
    index("task_message_id_idx").on(t.messageId),
    index("task_parent_idx").on(t.parentTaskId),
    // The heartbeat polls top-level tasks it follows that are due.
    index("task_follow_up_due_idx")
      .on(t.nextCheckAt)
      .where(
        sql`${t.followUp} = 'auto' and ${t.parentTaskId} is null and ${t.status} in ('backlog', 'in_progress')`,
      ),
    index("task_owner_idx").on(t.ownerUserId, t.status, t.updatedAt),
    // memory jobs scan finished tasks of the last day across owners
    index("task_status_updated_idx").on(t.status, t.updatedAt),
    index("task_search_idx").using("gin", searchVector(sql`${t.title} || ' ' || ${t.description}`)),
  ],
);

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
import { team } from "./teams";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;
const owner = () =>
  text("owner_user_id")
    .notNull()
    .references(() => user.id, restrict);
const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** Which bots a bot may open a group discussion with without asking (per user: sharing a bot never shares this list). */
export const botPeer = zetta.table(
  "bot_peer",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    peerBotId: uuid("peer_bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    createdAt: created(),
  },
  (t) => [
    index("bot_peer_bot_id_idx").on(t.botId),
    index("bot_peer_peer_bot_id_idx").on(t.peerBotId),
    unique("bot_peer_unique").on(t.ownerUserId, t.botId, t.peerBotId),
    check("bot_peer_self_check", sql`${t.botId} <> ${t.peerBotId}`),
  ],
);

/**
 * A group of bots working on one task. The transcript lives in its own conversation (kind "discussion"); `context` is the shared task
 * brief every member sees. `tainted` = outside content (customers, pages) is in play. Only a room that came from an outside channel (`originInbound`) holds
 * its code-capable members (not the bot that opened it) for one approved brief; other rooms never ask.
 */
export const discussion = zetta.table(
  "discussion",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    conversationId: uuid("conversation_id")
      .notNull()
      .unique()
      .references(() => conversation.id, restrict),
    createdByBotId: uuid("created_by_bot_id").references(() => bot.id, restrict),
    /** Set for a team room: the team's chief is the facilitator (`createdByBotId`). */
    teamId: uuid("team_id").references(() => team.id, restrict),
    originConversationId: uuid("origin_conversation_id").references(() => conversation.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
    originMessageId: uuid("origin_message_id").references(() => message.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
    /** The outside chat that started it (inbound): its bot may reply there, and only there. */
    originInbound: jsonb("origin_inbound").$type<{
      plugin: string;
      chat: string;
      chatName: string;
    }>(),
    title: text("title").notNull(),
    goal: text("goal").default("").notNull(),
    context: text("context").default("").notNull(),
    contextVersion: integer("context_version").default(1).notNull(),
    status: text("status", { enum: ["open", "paused", "stalled", "resolved", "cancelled"] })
      .default("open")
      .notNull(),
    /**
     * `room`: a user or team room. `help` and `permissions`: made by the Chief to solve a bot's issue; the UI keeps them out of the room list.
     * `bots`: a hidden room a bot opened for the bots to talk, for a rare important matter; it is not in the sidebar.
     */
    kind: text("kind", { enum: ["room", "help", "permissions", "bots"] })
      .default("room")
      .notNull(),
    tainted: boolean("tainted").default(false).notNull(),
    /** Turns run so far: a statistic, not a limit. */
    turnsUsed: integer("turns_used").default(0).notNull(),
    summary: text("summary").default("").notNull(),
    /** How far the room's work is, as its lead last reported it (0-100). Null until the first report. */
    progressPercent: integer("progress_percent"),
    /** The lead's short label for that report ("Tests written, review next"). */
    progressNote: text("progress_note").default("").notNull(),
    /** Which bot reported it, and when. */
    progressBotId: uuid("progress_bot_id").references(() => bot.id, setNull),
    progressAt: timestamp("progress_at", { withTimezone: true }),
    /** Same creator + origin + title while open = the same discussion (a bot repeating its open block gets the existing one). */
    openKey: text("open_key").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("discussion_origin_conversation_id_idx").on(t.originConversationId),
    index("discussion_created_by_bot_id_idx").on(t.createdByBotId),
    index("discussion_team_id_idx").on(t.teamId),
    index("discussion_origin_message_id_idx").on(t.originMessageId),
    index("discussion_owner_idx").on(t.ownerUserId, t.status),
    index("discussion_open_updated_idx")
      .on(t.updatedAt)
      .where(sql`${t.status} = 'open'`),
    /** Names of active rooms (discussions of a team) are unique per owner; a closed room frees its name. */
    uniqueIndex("discussion_room_name_unique")
      .on(t.ownerUserId, sql`lower(${t.title})`)
      .where(sql`${t.teamId} is not null and ${t.status} in ('open', 'paused', 'stalled')`),
    uniqueIndex("discussion_open_key")
      .on(t.ownerUserId, t.openKey)
      .where(sql`${t.status} in ('open', 'paused', 'stalled')`),
    check("discussion_title_check", sql`length(btrim(${t.title})) between 1 and 120`),
    check(
      "discussion_progress_check",
      sql`(${t.progressPercent} is null or ${t.progressPercent} between 0 and 100) and length(${t.progressNote}) <= 120`,
    ),
    index("discussion_progress_bot_id_idx").on(t.progressBotId),
    check(
      "discussion_context_check",
      sql`length(${t.context}) <= 8000 and length(${t.goal}) <= 1000`,
    ),
  ],
);

/** A bot in a discussion. `requireApproval`: while tainted, this member waits for one approved brief; approving it turns this off for the room. */
export const discussionMember = zetta.table(
  "discussion_member",
  {
    discussionId: uuid("discussion_id")
      .notNull()
      .references(() => discussion.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    role: text("role").default("").notNull(),
    requireApproval: boolean("require_approval").default(false).notNull(),
    turns: integer("turns").default(0).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("discussion_member_bot_id_idx").on(t.botId),
    primaryKey({ columns: [t.discussionId, t.botId] }),
    check("discussion_member_role_check", sql`length(${t.role}) <= 200`),
  ],
);

/** Durable queue of member turns: claimed one at a time per owner, recovered (never silently retried) after a restart. */
export const discussionTurn = zetta.table(
  "discussion_turn",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    discussionId: uuid("discussion_id")
      .notNull()
      .references(() => discussion.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    /** The post that woke this member (null for wrap-up turns). */
    triggerMessageId: uuid("trigger_message_id").references(() => message.id, setNull),
    kind: text("kind", { enum: ["reply", "wrapup"] })
      .default("reply")
      .notNull(),
    status: text("status", {
      enum: [
        "queued",
        "awaiting_approval",
        "running",
        "done",
        "failed",
        "skipped",
        "interrupted",
        "cancelled",
      ],
    })
      .default("queued")
      .notNull(),
    approvedContextVersion: integer("approved_context_version"),
    attempts: integer("attempts").default(0).notNull(),
    reasonCode: text("reason_code"),
    resultMessageId: uuid("result_message_id").references(() => message.id, setNull),
    createdAt: created(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** The server instance running this row (see server_instance). Recovery leaves the rows of a live instance alone. */
    ownerInstance: uuid("owner_instance"),
  },
  (t) => [
    index("discussion_turn_trigger_message_id_idx").on(t.triggerMessageId),
    index("discussion_turn_result_message_id_idx").on(t.resultMessageId),
    index("discussion_turn_bot_id_idx").on(t.botId),
    index("discussion_turn_owner_user_id_idx").on(t.ownerUserId),
    uniqueIndex("discussion_turn_wake_unique").on(
      t.discussionId,
      t.botId,
      t.triggerMessageId,
      t.kind,
    ),
    index("discussion_turn_status_idx").on(t.status, t.createdAt),
  ],
);

export type TurnStep = {
  at: string;
  kind: "activity" | "computer" | "tool" | "post" | "report" | "error";
  label: string;
  detail?: string;
};
/** The steps of one member turn, for the room drawer. Always an object (`{ steps: [...] }`), never a bare array; it only holds data and timestamps. */
export const turnStep = zetta.table(
  "turn_step",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: owner(),
    discussionTurnId: uuid("discussion_turn_id")
      .notNull()
      .unique()
      .references(() => discussionTurn.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    messageId: uuid("message_id").references(() => message.id, setNull),
    data: jsonb("data").$type<{ steps: TurnStep[] }>().default({ steps: [] }).notNull(),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("turn_step_bot_id_idx").on(t.botId),
    index("turn_step_message_id_idx").on(t.messageId),
    index("turn_step_owner_user_id_idx").on(t.ownerUserId),
    check(
      "turn_step_data_check",
      sql`jsonb_typeof(${t.data}) = 'object' and jsonb_typeof(${t.data} -> 'steps') = 'array'`,
    ),
  ],
);

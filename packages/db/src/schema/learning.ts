import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ITEM_USE_EXPOSURES,
  ITEM_USE_KINDS,
  ITEM_USE_ORIGINS,
  FINDING_KINDS,
  FINDING_STATUSES,
  LEARNING_BATCH_MODES,
  LEARNING_FORGET_MODES,
  LEARNING_RUN_KINDS,
  LEARNING_RUN_STATUSES,
  LEARNING_RUN_TRIGGERS,
  LEARNING_STRICTNESS,
  LEARNING_TIDY_MODES,
  LESSON_ACTORS,
  LESSON_BASES,
  LESSON_DROP_REASONS,
  LESSON_EVENT_KINDS,
  LESSON_KINDS,
  LESSON_ORIGINS,
  LESSON_SCOPES,
  LESSON_STATUSES,
  REPLY_OUTCOMES,
  REPLY_SIGNALS,
} from "@zetta/core/learning";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot, conversation, message } from "./chat";
import { memoryItem } from "./memory";
import { skill } from "./skills";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const cascade = { onDelete: "cascade", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;

/**
 * One memory item or skill that was in front of a bot when it wrote one reply (see modules/learning). Written once, after the reply is
 * saved; never changed. `ref_id` is a memory item or a skill: no foreign key, because it points at either, and an archived item keeps
 * its history. Rows go with their reply, and after `ITEM_USE_KEEP_DAYS`.
 */
export const itemUse = zetta.table(
  "item_use",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, cascade),
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, cascade),
    refKind: text("ref_kind", { enum: ITEM_USE_KINDS }).notNull(),
    refId: uuid("ref_id").notNull(),
    exposure: text("exposure", { enum: ITEM_USE_EXPOSURES }).notNull(),
    origin: text("origin", { enum: ITEM_USE_ORIGINS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // A retry of the same reply writes nothing twice.
    uniqueIndex("item_use_reply_ref_unique").on(t.messageId, t.refKind, t.refId),
    index("item_use_ref_idx").on(t.refKind, t.refId, t.createdAt),
    index("item_use_bot_idx").on(t.botId, t.createdAt),
    index("item_use_created_idx").on(t.createdAt),
  ],
);

/**
 * How one reply went: the answer to "did the person have to step in?", judged once from what happened to it (stored signals, never
 * the model's opinion). One row per reply that had an item in front of it. `pending` until the person's next message, a stop, a rating
 * or a day settles it; a late rating judges it again. The signals that decide it are kept, so a verdict can be explained.
 */
export const replyOutcome = zetta.table(
  "reply_outcome",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, cascade),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    origin: text("origin", { enum: ITEM_USE_ORIGINS }).notNull(),
    outcome: text("outcome", { enum: REPLY_OUTCOMES }).default("pending").notNull(),
    signals: text("signals")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    /** The sum of the signals' weights (core/learning.ts `SIGNAL_WEIGHTS`): its sign is the outcome, its size how sure. */
    weight: smallint("weight").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.messageId] }),
    index("reply_outcome_bot_idx").on(t.botId, t.createdAt),
    index("reply_outcome_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.outcome} = 'pending'`),
    check(
      "reply_outcome_signals_check",
      sql`${t.signals} <@ ARRAY[${sql.raw(REPLY_SIGNALS.map((s) => `'${s}'`).join(","))}]::text[]`,
    ),
    check("reply_outcome_weight_check", sql`${t.weight} between -20 and 20`),
  ],
);

export type ItemUseRow = typeof itemUse.$inferSelect;
export type ReplyOutcomeRow = typeof replyOutcome.$inferSelect;

/**
 * Something a bot learned from its owner (modules/learning). One row per lesson, from the day it was a candidate to the day it was
 * dropped; every step is a `bot_lesson_event`. A lesson in use is a small memory item (`memory_item_id`) tagged `lesson`: every engine
 * reads it, and dropping one is archiving that item. How well it did is never stored here: it is computed from `item_use` and
 * `reply_outcome`. A skill the bot learned before lessons existed has a row too (`skill_id`, origin `backfill`).
 */
export const botLesson = zetta.table(
  "bot_lesson",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    /** The memory item that carries the text once the lesson is in use. Null while it is a candidate. */
    memoryItemId: uuid("memory_item_id").references(() => memoryItem.id, setNull),
    /** The old learned skill this row stands for. */
    skillId: uuid("skill_id").references(() => skill.id, setNull),
    /** The lesson in one sentence (a `rule`: at most `LESSON_MAX_CHARS`; a `procedure` waits as a candidate for a person to turn into an item). */
    text: text("text").notNull(),
    /** A few words on what it is about: what the lesson is matched against the work with, and its tag. */
    topic: text("topic").default("").notNull(),
    kind: text("kind", { enum: LESSON_KINDS }).default("rule").notNull(),
    scope: text("scope", { enum: LESSON_SCOPES }).default("topic").notNull(),
    status: text("status", { enum: LESSON_STATUSES }).default("candidate").notNull(),
    /** Why it passed the checks. Null for a candidate that is waiting for a second sighting. */
    basis: text("basis", { enum: LESSON_BASES }),
    origin: text("origin", { enum: LESSON_ORIGINS }).default("batch").notNull(),
    dropReason: text("drop_reason", { enum: LESSON_DROP_REASONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("bot_lesson_bot_idx").on(t.botId, t.status),
    index("bot_lesson_owner_idx").on(t.ownerUserId, t.status),
    uniqueIndex("bot_lesson_item_unique")
      .on(t.memoryItemId)
      .where(sql`${t.memoryItemId} is not null`),
    check("bot_lesson_text_check", sql`char_length(${t.text}) between 1 and 2000`),
    check("bot_lesson_topic_check", sql`char_length(${t.topic}) <= 60`),
  ],
);

/** The words of the person that taught a lesson: a verbatim quote of one of their messages, kept even if the chat is deleted. */
export const botLessonEvidence = zetta.table(
  "bot_lesson_evidence",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => botLesson.id, cascade),
    conversationId: uuid("conversation_id").references(() => conversation.id, setNull),
    messageId: uuid("message_id").references(() => message.id, setNull),
    quote: text("quote").notNull(),
    /** The day the person said it (UTC): "seen twice" counts distinct days or chats. */
    day: date("day", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("bot_lesson_evidence_lesson_idx").on(t.lessonId),
    uniqueIndex("bot_lesson_evidence_message_unique")
      .on(t.lessonId, t.messageId)
      .where(sql`${t.messageId} is not null`),
    check("bot_lesson_evidence_quote_check", sql`char_length(${t.quote}) between 1 and 500`),
  ],
);

/** Every step of a lesson's life, in order: the record that lets a wrong drop be traced and brought back. */
export const botLessonEvent = zetta.table(
  "bot_lesson_event",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => botLesson.id, cascade),
    kind: text("kind", { enum: LESSON_EVENT_KINDS }).notNull(),
    by: text("by", { enum: LESSON_ACTORS }).notNull(),
    detail: text("detail").default("").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("bot_lesson_event_lesson_idx").on(t.lessonId, t.at),
    check("bot_lesson_event_detail_check", sql`char_length(${t.detail}) <= 1000`),
  ],
);

/**
 * One reading of a bot's chats for lessons. The daily pass is claimed by the unique index (one per bot per day), so a restart or a second
 * server cannot run it twice; "Run now" is a `manual` run and is held back by a cooldown instead. Tokens are in `audit_event`
 * (kind `learning_run`).
 */
export const learningRun = zetta.table(
  "learning_run",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    day: date("day", { mode: "string" }).notNull(),
    kind: text("kind", { enum: LEARNING_RUN_KINDS }).default("batch").notNull(),
    trigger: text("trigger", { enum: LEARNING_RUN_TRIGGERS }).notNull(),
    status: text("status", { enum: LEARNING_RUN_STATUSES }).default("running").notNull(),
    /** Why a run was skipped or failed, or what it did, in a short sentence for the page. */
    detail: text("detail").default("").notNull(),
    candidates: integer("candidates").default(0).notNull(),
    promoted: integer("promoted").default(0).notNull(),
    windowFrom: timestamp("window_from", { withTimezone: true }).notNull(),
    windowTo: timestamp("window_to", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("learning_run_daily_unique")
      .on(t.botId, t.day, t.kind)
      .where(sql`${t.trigger} = 'daily'`),
    index("learning_run_bot_idx").on(t.botId, t.startedAt),
    check("learning_run_detail_check", sql`char_length(${t.detail}) <= 1000`),
  ],
);

/** What a person lets the learning jobs do, and how strict the trial is. One row per person; no row means the defaults. */
export const learningPolicy = zetta.table("learning_policy", {
  ownerUserId: text("owner_user_id")
    .primaryKey()
    .references(() => user.id, restrict),
  batch: text("batch", { enum: LEARNING_BATCH_MODES }).default("daily").notNull(),
  forget: text("forget", { enum: LEARNING_FORGET_MODES }).default("on").notNull(),
  tidy: text("tidy", { enum: LEARNING_TIDY_MODES }).default("weekly").notNull(),
  strictness: text("strictness", { enum: LEARNING_STRICTNESS }).default("normal").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BotLessonRow = typeof botLesson.$inferSelect;
export type LearningRunRow = typeof learningRun.$inferSelect;
export type LearningPolicyRow = typeof learningPolicy.$inferSelect;

/**
 * A suggestion from the tidy-up (modules/learning/tidy.ts) or the forgetting job: two items that say the same thing, a lesson that no
 * longer helps... Never applied by itself. `refs` are the lessons or memory items it is about; `ref_hash` is what makes the same
 * suggestion appear once, and a dismissed one stay dismissed.
 */
export const learningFinding = zetta.table(
  "learning_finding",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    kind: text("kind", { enum: FINDING_KINDS }).notNull(),
    refs: jsonb("refs").$type<{ kind: "lesson" | "memory"; id: string }[]>().notNull(),
    refHash: text("ref_hash").notNull(),
    /** One sentence for the page: what was found, and what accepting does. */
    summary: text("summary").notNull(),
    status: text("status", { enum: FINDING_STATUSES }).default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("learning_finding_unique").on(t.ownerUserId, t.kind, t.refHash),
    index("learning_finding_owner_idx").on(t.ownerUserId, t.status),
    check("learning_finding_summary_check", sql`char_length(${t.summary}) between 1 and 1000`),
  ],
);
export type LearningFindingRow = typeof learningFinding.$inferSelect;

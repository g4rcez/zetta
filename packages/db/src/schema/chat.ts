import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { OUTPUT_STYLE_KEYS, outputStyle } from "./output-styles";
import { searchVector } from "./search";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;
const cascade = { onDelete: "cascade", onUpdate: "restrict" } as const;

/** Visual grouping of bots. Never an access boundary (RFC-001). */
export const workspace = zetta.table(
  "workspace",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    name: text("name").notNull(),
    // Inner groups: a workspace may sit inside another of the same owner (checked by the service).
    parentId: uuid("parent_id").references((): AnyPgColumn => workspace.id, restrict),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("workspace_parent_id_idx").on(table.parentId),
    unique("workspace_owner_name_unique").on(table.ownerUserId, table.name),
    check("workspace_name_check", sql`length(btrim(${table.name})) between 1 and 80`),
  ],
);

export const bot = zetta.table(
  "bot",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    kind: text("kind", { enum: ["chief", "specialist"] }).notNull(),
    visibility: text("visibility", { enum: ["private", "team"] }).notNull(),
    workspaceId: uuid("workspace_id").references(() => workspace.id, restrict),
    name: text("name").notNull(),
    // Friendly-url id, unique across the installation and fixed at creation (renames keep it). Names the bot's database schema (`<snake>_bot`).
    slug: text("slug").notNull(),
    description: text("description").default("").notNull(),
    harness: text("harness", {
      enum: [
        "pi",
        "codex",
        "omp",
        "claude-code",
        "opencode",
        "cursor",
        "hermes",
        "fixture",
        "decision",
      ],
    })
      .default("fixture")
      .notNull(),
    model: text("model"),
    personality: text("personality").default("").notNull(),
    instructions: text("instructions").default("").notNull(),
    // Tone of voice: a built-in key, or `custom` + `output_style_id` (live reference, so edits reach every bot using it).
    outputStyle: text("output_style", { enum: OUTPUT_STYLE_KEYS }).default("default").notNull(),
    outputStyleId: uuid("output_style_id").references(() => outputStyle.id, restrict),
    // Picture: a frontend-built SVG preset with its colors, or an uploaded image (data URL). Null = generated default.
    avatar: jsonb("avatar").$type<
      { kind: "preset"; preset: string; colors: string[] } | { kind: "image"; src: string }
    >(),
    onboarded: boolean("onboarded").default(true).notNull(),
    // Computer use the owner granted this bot: off (default), browser only, or browser + desktop.
    computerMode: text("computer_mode", { enum: ["off", "browser", "desktop"] })
      .default("off")
      .notNull(),
    // Code access the owner granted this bot: a persistent per-user workspace where it can run git, edit files and push. On by default.
    codeAccess: boolean("code_access").default(true).notNull(),
    // Who a commit of this bot is signed as: the server's git config (default), the bot's own address, the owner's account, or `commit_email`.
    commitIdentity: text("commit_identity", { enum: ["git-config", "bot", "account", "custom"] })
      .default("git-config")
      .notNull(),
    commitEmail: text("commit_email"),
    // Connections this bot needs before it is ready ([{ key, provider }]); bound per user in bot_connection.
    requiredConnections: jsonb("required_connections")
      .$type<{ key: string; provider: string }[]>()
      .default([])
      .notNull(),
    archived: boolean("archived").default(false).notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bot_workspace_id_idx").on(table.workspaceId),
    index("bot_owner_idx").on(table.ownerUserId),
    // At most one personal chief per user, stable across workspace moves.
    uniqueIndex("bot_one_chief_per_owner")
      .on(table.ownerUserId)
      .where(sql`${table.kind} = 'chief'`),
    check(
      "bot_chief_private_check",
      sql`${table.kind} <> 'chief' or ${table.visibility} = 'private'`,
    ),
    check("bot_name_check", sql`length(btrim(${table.name})) between 1 and 80`),
    index("bot_output_style_id_idx").on(table.outputStyleId),
    check(
      "bot_output_style_check",
      sql`(${table.outputStyle} = 'custom') = (${table.outputStyleId} is not null)`,
    ),
    uniqueIndex("bot_slug_key").on(table.slug),
    check(
      "bot_slug_check",
      sql`${table.slug} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(${table.slug}) <= 48 and ${table.slug} !~ '^pg-'`,
    ),
  ],
);

export const conversation = zetta.table(
  "conversation",
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
    // chat: a person with a bot. discussion: a group of bots (transcript of modules/discussions). inbound: outside people via a plugin channel.
    kind: text("kind", { enum: ["chat", "discussion", "inbound"] })
      .default("chat")
      .notNull(),
    title: text("title").default("New chat").notNull(),
    // Like tmux automatic-rename: a person's rename sets "manual" and the bot turn never names the chat again.
    titleSource: text("title_source", { enum: ["auto", "manual"] })
      .default("auto")
      .notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    favorite: boolean("favorite").default(false).notNull(),
    /** Threads: an archived conversation leaves the tab bar and lists, and opening it restores it. */
    archived: boolean("archived").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Frozen memory prompt block per bot, captured at the first turn so the prefix stays stable for the whole conversation. */
    memorySnapshot:
      jsonb("memory_snapshot").$type<
        Record<
          string,
          { user: { id: string; content: string }[]; memory: { id: string; content: string }[] }
        >
      >(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("conversation_bot_id_idx").on(table.botId),
    index("conversation_owner_idx").on(table.ownerUserId, table.updatedAt),
    index("conversation_search_idx").using("gin", searchVector(table.title)),
  ],
);

export const message = zetta.table(
  "message",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, restrict),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    seq: integer("seq").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    // running: generation in progress (persisted early so a disconnect or crash never loses partial output).
    status: text("status", { enum: ["complete", "failed", "running", "interrupted", "cancelled"] })
      .default("complete")
      .notNull(),
    clientRequestId: text("client_request_id"),
    mentions: jsonb("mentions"),
    // Provenance for the answer: which memories/instructions were used, learning receipts, tool notes. Never secrets.
    meta: jsonb("meta"),
    // Bot configuration version that produced an assistant message; onboarding evidence is version-specific.
    botVersion: integer("bot_version"),
    // Thread reply when set; points at a message in the same conversation.
    parentMessageId: uuid("parent_message_id").references((): AnyPgColumn => message.id, setNull),
    // Author bot for assistant messages: the conversation's own bot, or a member bot in a room. Never another bot's chat (insertMessage and the message_author_guard trigger refuse it).
    botId: uuid("author_bot_id").references(() => bot.id, setNull),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("message_parent_message_id_idx").on(table.parentMessageId),
    index("message_author_bot_id_idx").on(table.botId),
    index("message_owner_user_id_idx").on(table.ownerUserId),
    unique("message_conversation_seq_unique").on(table.conversationId, table.seq),
    uniqueIndex("message_client_request_unique")
      .on(table.conversationId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    check("message_content_check", sql`length(${table.content}) <= 65536`),
    index("message_search_idx").using("gin", searchVector(table.content)),
  ],
);

/** A user message sent while its chat was busy: saved at once, answered in its thread when the turn before it ends. The row is deleted
 * when that answer ends, so it only lives while the message waits or is being answered (and survives a restart). */
export const chatQueue = zetta.table(
  "chat_queue",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, cascade),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, cascade),
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, cascade),
    status: text("status", { enum: ["pending", "running", "failed"] })
      .default("pending")
      .notNull(),
    // Starts of this answer; a message that keeps failing (or crashing the process) stops at a limit instead of looping.
    attempts: integer("attempts").default(0).notNull(),
    reasonCode: text("reason_code"),
    // Send options read when the answer runs: { fileRefs, wikiIds }.
    input: jsonb("input"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("chat_queue_message_unique").on(table.messageId),
    index("chat_queue_conversation_created_idx").on(table.conversationId, table.createdAt),
    index("chat_queue_status_created_idx").on(table.status, table.createdAt),
    index("chat_queue_owner_user_id_idx").on(table.ownerUserId),
  ],
);

/** Immutable per-version copy of a bot's configuration, so a run or proposal can be tied to the exact settings it used. */
export const botRevision = zetta.table(
  "bot_revision",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    version: integer("version").notNull(),
    config: jsonb("config").notNull(),
    changedByUserId: text("changed_by_user_id")
      .notNull()
      .references(() => user.id, restrict),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bot_revision_changed_by_user_id_idx").on(table.changedByUserId),
    unique("bot_revision_unique").on(table.botId, table.version),
  ],
);

/**
 * A goal a bot keeps working on across turns, started only after the user approved it (a `start_loop` proposal). Each iteration is one
 * chat turn in the conversation; the bot ends it with goal_progress (keep going) or goal_done. No fixed turn limit: it pauses when it stops
 * making progress, keeps failing, hands off, or the user presses Stop.
 */
export const goalLoop = zetta.table(
  "goal_loop",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    goal: text("goal").notNull(),
    doneWhen: text("done_when").notNull(),
    /** The user's own words that led to the loop: every step reads them, and goal_done is checked against them. */
    request: text("request").default("").notNull(),
    status: text("status", { enum: ["running", "paused", "done", "failed", "cancelled"] })
      .default("running")
      .notNull(),
    iterations: integer("iterations").default(0).notNull(),
    /** The bot's latest summary of what is done and what is left. */
    progress: text("progress").default("").notNull(),
    /** Iterations in a row without new progress or with an error; the loop pauses at 3. */
    stalls: integer("stalls").default(0).notNull(),
    reason: text("reason"),
    /** Failed steps in a row. Separate from `stalls`: a failure waits (backoff), a stall changes approach. */
    failures: integer("failures").default(0).notNull(),
    /** While set and in the future, the driver waits before the next step. */
    retryAt: timestamp("retry_at", { withTimezone: true }),
    /** Why the last step failed, handed to the bot in the next step's prompt. */
    lastError: text("last_error"),
    /** What the bot learned along the way, newest last; the next steps read it. */
    lessons: text("lessons").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("goal_loop_owner_user_id_idx").on(table.ownerUserId),
    index("goal_loop_bot_id_idx").on(table.botId),
    index("goal_loop_conversation_idx").on(table.conversationId, table.status),
    // The driver polls running loops that are due.
    index("goal_loop_running_retry_idx")
      .on(table.retryAt)
      .where(sql`${table.status} = 'running'`),
    // wiki jobs scan finished loops of the last day across owners
    index("goal_loop_status_updated_idx").on(table.status, table.updatedAt),
    // One active loop per bot in a conversation: team members each pursue their own goal in the room's conversation.
    uniqueIndex("goal_loop_one_active")
      .on(table.conversationId, table.botId)
      .where(sql`${table.status} in ('running', 'paused')`),
  ],
);

import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;

/** Visual grouping of bots. Never an access boundary (RFC-001). */
export const workspace = pgTable(
  "workspace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id, restrict),
    name: text("name").notNull(),
    // Inner groups: a workspace may sit inside another of the same owner (checked by the service).
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("workspace_owner_name_unique").on(table.ownerUserId, table.name),
    check("workspace_name_check", sql`length(btrim(${table.name})) between 1 and 80`),
  ],
);

export const bot = pgTable(
  "bot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id, restrict),
    kind: text("kind", { enum: ["chief", "specialist"] }).notNull(),
    visibility: text("visibility", { enum: ["private", "team"] }).notNull(),
    workspaceId: uuid("workspace_id").references(() => workspace.id, restrict),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    harness: text("harness", { enum: ["pi", "codex", "omp", "claude-code", "opencode", "cursor", "fixture"] }).default("fixture").notNull(),
    model: text("model"),
    personality: text("personality").default("").notNull(),
    instructions: text("instructions").default("").notNull(),
    // Picture: a frontend-built SVG preset with its colors, or an uploaded image (data URL). Null = generated default.
    avatar: jsonb("avatar").$type<{ kind: "preset"; preset: string; colors: string[] } | { kind: "image"; src: string }>(),
    onboarded: boolean("onboarded").default(false).notNull(),
    // Computer use the owner granted this bot: off (default), browser only, or browser + desktop.
    computerMode: text("computer_mode", { enum: ["off", "browser", "desktop"] }).default("off").notNull(),
    // Code access the owner granted this bot: a persistent per-user workspace where it can run git, edit files and push. On by default.
    codeAccess: boolean("code_access").default(true).notNull(),
    // Connections this bot needs before it is ready ([{ key, provider }]); bound per user in bot_connection.
    requiredConnections: jsonb("required_connections").$type<{ key: string; provider: string }[]>().default([]).notNull(),
    archived: boolean("archived").default(false).notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bot_owner_idx").on(table.ownerUserId),
    // At most one personal chief per user, stable across workspace moves.
    uniqueIndex("bot_one_chief_per_owner").on(table.ownerUserId).where(sql`${table.kind} = 'chief'`),
    check("bot_chief_private_check", sql`${table.kind} <> 'chief' or ${table.visibility} = 'private'`),
    check("bot_name_check", sql`length(btrim(${table.name})) between 1 and 80`),
  ],
);

export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id, restrict),
    botId: uuid("bot_id").notNull().references(() => bot.id, restrict),
    title: text("title").default("New chat").notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    favorite: boolean("favorite").default(false).notNull(),
    /** Frozen memory prompt block per bot, captured at the first turn so the prefix stays stable for the whole conversation. */
    memorySnapshot: jsonb("memory_snapshot").$type<Record<string, { user: { id: string; content: string }[]; memory: { id: string; content: string }[] }>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("conversation_owner_idx").on(table.ownerUserId, table.updatedAt)],
);

export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversation.id, restrict),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id, restrict),
    seq: integer("seq").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    // running: generation in progress (persisted early so a disconnect or crash never loses partial output).
    status: text("status", { enum: ["complete", "failed", "running", "interrupted", "cancelled"] }).default("complete").notNull(),
    clientRequestId: text("client_request_id"),
    mentions: jsonb("mentions"),
    // Provenance for the answer: which memories/instructions were used, learning receipts, tool notes. Never secrets.
    meta: jsonb("meta"),
    // Bot configuration version that produced an assistant message; onboarding evidence is version-specific.
    botVersion: integer("bot_version"),
    // Thread reply when set; points at a message in the same conversation.
    parentMessageId: uuid("parent_message_id"),
    // Author bot for assistant messages (mentions/delegation can come from a bot other than the chat's bot).
    botId: uuid("author_bot_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("message_conversation_seq_unique").on(table.conversationId, table.seq),
    uniqueIndex("message_client_request_unique").on(table.conversationId, table.clientRequestId).where(sql`${table.clientRequestId} is not null`),
    check("message_content_check", sql`length(${table.content}) <= 65536`),
  ],
);

/** Immutable per-version copy of a bot's configuration, so a run or proposal can be tied to the exact settings it used. */
export const botRevision = pgTable(
  "bot_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id").notNull().references(() => bot.id, restrict),
    version: integer("version").notNull(),
    config: jsonb("config").notNull(),
    changedByUserId: text("changed_by_user_id").notNull().references(() => user.id, restrict),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("bot_revision_unique").on(table.botId, table.version)],
);

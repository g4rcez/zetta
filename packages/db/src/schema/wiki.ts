import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { bot, conversation } from "./chat";
import { EMBEDDING_DIMENSIONS, searchVector } from "./search";
import { team } from "./teams";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;
/** A revision is part of its page's history, so it goes with the page. */
const cascade = { onDelete: "cascade", onUpdate: "restrict" } as const;

/**
 * Who may read an item. solo: only the bot that wrote it (a bot's own notes). owner: every bot of the owner. teams: only bots in the
 * item's teams (`wiki_page_team`). all: also read (never written) by every active member's bots; the owner publishes it explicitly.
 */
export const WIKI_TYPES = ["solo", "owner", "teams", "all"] as const;
export type WikiType = (typeof WIKI_TYPES)[number];
/** stale: a person or bot marked it as possibly out of date; it is still found, with that warning. archived: hidden from bots and search. */
export const WIKI_PAGE_STATUSES = ["current", "stale", "archived"] as const;
export type WikiPageStatus = (typeof WIKI_PAGE_STATUSES)[number];
/** system: the source check (marks a page stale when its evidence changed). */
export const WIKI_AUTHORS = ["user", "bot", "system"] as const;
/** How one item points to another. `related` is a plain `[[slug]]`; the others are written `[[depends-on:slug]]`. */
export const WIKI_RELATIONS = ["related", "depends-on", "part-of", "supersedes"] as const;
export type WikiRelation = (typeof WIKI_RELATIONS)[number];
export const WIKI_SCORE_MAX = 100;
export const WIKI_SCORE_DEFAULT = 50;

/**
 * The operator's wiki: one graph of items (facts, procedures, bot notes, indexed documents), one topic per item. An item belongs to one
 * user and is read by the bots its `type` allows; it never reaches another user's turns unless published (`all`). `tags`, `howto` (when
 * and how to use it) and `score` (how important, 0-100) help bots find it; `wiki_link` holds the typed edges written as `[[slug]]` in the
 * content. Bots search it and read only what they need, instead of receiving all of it in every prompt. Every write keeps the previous
 * text in `wiki_revision`.
 */
export const wikiPage = pgTable(
  "wiki_page",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    /** Stable name in links (`[[slug]]`) and tool calls; lower-case words joined by hyphens. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    type: text("type", { enum: WIKI_TYPES }).default("owner").notNull(),
    /** Short text shown in search results and in the prompt index: when to use this item and how. Embedded with every chunk. */
    howto: text("howto").default("").notNull(),
    content: text("content").notNull(),
    /** Free labels (what kind of item: `gotcha`, `instruction`, `profile`...). Part of the keyword and vector match. */
    tags: text("tags")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    /** How important it is, 0-100. Ranks search results and orders what is always put in the prompt. */
    score: integer("score").default(WIKI_SCORE_DEFAULT).notNull(),
    status: text("status", { enum: WIKI_PAGE_STATUSES }).default("current").notNull(),
    version: integer("version").default(1).notNull(),
    updatedBy: text("updated_by", { enum: WIKI_AUTHORS }).default("user").notNull(),
    updatedByBotId: uuid("updated_by_bot_id").references(() => bot.id, setNull),
    /** The bot that created the item. For `solo` it is the only bot that reads it. Null when a person or the system created it. */
    authorBotId: uuid("author_bot_id").references(() => bot.id, setNull),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("wiki_page_owner_slug").on(t.ownerUserId, t.slug),
    /** A shared page is found by its slug alone, so two members cannot share the same slug. */
    uniqueIndex("wiki_page_shared_slug")
      .on(t.slug)
      .where(sql`${t.type} = 'all'`),
    check("wiki_page_score", sql`${t.score} between 0 and ${sql.raw(String(WIKI_SCORE_MAX))}`),
    index("wiki_page_owner_idx").on(t.ownerUserId, t.status),
    index("wiki_page_author_bot_idx").on(t.authorBotId),
    index("wiki_page_tags_idx").using("gin", t.tags),
    index("wiki_page_search_idx").using(
      "gin",
      searchVector(sql`${t.title} || ' ' || ${t.howto} || ' ' || ${t.content}`),
    ),
  ],
);

/** The teams of an item with type `teams`: only bots that are members of one of them read it. */
export const wikiPageTeam = pgTable(
  "wiki_page_team",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => wikiPage.id, cascade),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, restrict),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.teamId] }),
    index("wiki_page_team_team_idx").on(t.teamId),
  ],
);

/**
 * An edge of the knowledge graph, rebuilt from the content on every save. The target is a slug, not an id: it resolves against the
 * reader's visible items, so a link never shows an item the reader cannot read, and it can point to an item written later.
 */
export const wikiLink = pgTable(
  "wiki_link",
  {
    fromPageId: uuid("from_page_id")
      .notNull()
      .references(() => wikiPage.id, cascade),
    relation: text("relation", { enum: WIKI_RELATIONS }).default("related").notNull(),
    toSlug: text("to_slug").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromPageId, t.relation, t.toSlug] }),
    index("wiki_link_to_idx").on(t.toSlug),
  ],
);

/**
 * A piece of an item's content with its embedding, for the vector side of search. Rebuilt after every save by the ticker; a chunk with a
 * null embedding is still found by keywords on the item and is embedded on a later run. The embedded text also carries the item's title,
 * howto and tags, which are not stored here.
 */
export const wikiChunk = pgTable(
  "wiki_chunk",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    pageId: uuid("page_id")
      .notNull()
      .references(() => wikiPage.id, cascade),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    ord: integer("ord").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("wiki_chunk_page_ord").on(t.pageId, t.ord),
    index("wiki_chunk_owner_idx").on(t.ownerUserId),
    index("wiki_chunk_unembedded_idx")
      .on(t.createdAt)
      .where(sql`${t.embedding} is null`),
    index("wiki_chunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** Each saved version of a page, written in the same transaction as the page. A restore writes a new version with old text. */
export const wikiRevision = pgTable(
  "wiki_revision",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    pageId: uuid("page_id")
      .notNull()
      .references(() => wikiPage.id, cascade),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    howto: text("howto").notNull(),
    content: text("content").notNull(),
    tags: text("tags")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    status: text("status", { enum: WIKI_PAGE_STATUSES }).notNull(),
    author: text("author", { enum: WIKI_AUTHORS }).notNull(),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    /** The chat the bot wrote it from, so a person can see why it changed. */
    conversationId: uuid("conversation_id").references(() => conversation.id, setNull),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("wiki_revision_page_version").on(t.pageId, t.version),
    index("wiki_revision_owner_idx").on(t.ownerUserId),
  ],
);

export const WIKI_JOB_KINDS = ["learn", "review"] as const;
export const WIKI_JOB_SOURCES = ["task", "loop", "user"] as const;
/** What a review job works on: every check, or one group of them. */
export const WIKI_JOB_PROBLEMS = [
  "all",
  "brokenLinks",
  "unlinked",
  "old",
  "stale",
  "unsourced",
] as const;
export const WIKI_JOB_STATUSES = ["pending", "running", "done", "failed", "skipped"] as const;

/**
 * Background wiki work. learn: after a task or goal loop of a chat finished, its bot reads the chat once and saves what other bots will
 * need. review: the chief reads the wiki checks and fixes contradictions and duplicates. One learn job per task or loop.
 */
export const wikiJob = pgTable(
  "wiki_job",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    kind: text("kind", { enum: WIKI_JOB_KINDS }).notNull(),
    source: text("source", { enum: WIKI_JOB_SOURCES }).notNull(),
    /** The task or goal loop id; null for a review the user asked for. */
    sourceId: uuid("source_id"),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    conversationId: uuid("conversation_id").references(() => conversation.id, setNull),
    /** For a review: which group of checks the chief fixes. Its chat is `conversationId`, which no chat list shows. */
    problem: text("problem", { enum: WIKI_JOB_PROBLEMS }).default("all").notNull(),
    status: text("status", { enum: WIKI_JOB_STATUSES }).default("pending").notNull(),
    /** A finished task often gets a last message or two; the job waits a little so it reads the whole chat. */
    runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
    attempts: integer("attempts").default(0).notNull(),
    /** What changed (page slugs) or a closed failure code. */
    result: text("result").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("wiki_job_source_once")
      .on(t.kind, t.source, t.sourceId)
      .where(sql`${t.sourceId} is not null`),
    index("wiki_job_due_idx").on(t.status, t.runAfter),
    index("wiki_job_owner_idx").on(t.ownerUserId, t.createdAt),
  ],
);

export const WIKI_SUGGESTION_STATUSES = [
  "open",
  "accepted",
  "rejected",
  "withdrawn",
  "outdated",
] as const;

/** A change another member (or their bot) proposes to a shared page. Only the page owner applies it; it never edits the page by itself. */
export const wikiSuggestion = pgTable(
  "wiki_suggestion",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    pageId: uuid("page_id")
      .notNull()
      .references(() => wikiPage.id, cascade),
    pageOwnerUserId: text("page_owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    title: text("title").notNull(),
    howto: text("howto").notNull(),
    content: text("content").notNull(),
    tags: text("tags")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    reason: text("reason").default("").notNull(),
    /** The page version it was written against: accepting it after the page changed is refused (outdated). */
    baseVersion: integer("base_version").notNull(),
    status: text("status", { enum: WIKI_SUGGESTION_STATUSES }).default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("wiki_suggestion_open_once")
      .on(t.pageId, t.authorUserId)
      .where(sql`${t.status} = 'open'`),
    index("wiki_suggestion_owner_idx").on(t.pageOwnerUserId, t.status),
    index("wiki_suggestion_author_idx").on(t.authorUserId, t.status),
  ],
);

export const WIKI_SOURCE_KINDS = ["task", "doc", "artifact", "url"] as const;
export type WikiSourceKind = (typeof WIKI_SOURCE_KINDS)[number];
export const WIKI_SOURCE_STATUSES = ["current", "changed", "gone"] as const;

/**
 * Evidence for a page: the task, company document (knowledge_doc), artifact or web address its facts came from, with the version seen when
 * the page was last saved in full. When a task, document or artifact changes or goes away, the page is marked stale. URLs are only kept.
 */
export const wikiSource = pgTable(
  "wiki_source",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    pageId: uuid("page_id")
      .notNull()
      .references(() => wikiPage.id, cascade),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    kind: text("kind", { enum: WIKI_SOURCE_KINDS }).notNull(),
    /** The task, knowledge_doc or artifact id, or the https address. */
    ref: text("ref").notNull(),
    /** Display name at the time it was linked (task title, document or artifact name). */
    label: text("label").default("").notNull(),
    seenVersion: text("seen_version").default("").notNull(),
    status: text("status", { enum: WIKI_SOURCE_STATUSES }).default("current").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("wiki_source_page_ref").on(t.pageId, t.kind, t.ref),
    index("wiki_source_check_idx").on(t.status, t.checkedAt),
    index("wiki_source_owner_idx").on(t.ownerUserId),
  ],
);

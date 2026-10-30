import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { searchVector } from "./search";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
/** Documents and chunks only exist as a copy of a source, so they go with it. */
const cascade = { onDelete: "cascade", onUpdate: "restrict" } as const;

/** Size of the embedding model's vectors (multilingual-e5-small). Changing the model means changing this and re-embedding. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * One user's connected document store whose files are indexed for the bot to answer from. The index is per user: it is built with that
 * user's own token and only that user's turns can read it, so a document can never reach someone who could not open it.
 */
export const knowledgeSource = pgTable(
  "knowledge_source",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    provider: text("provider", { enum: ["google_drive"] }).notNull(),
    status: text("status", { enum: ["idle", "syncing", "error", "needs_auth"] })
      .default("idle")
      .notNull(),
    /** Drive `changes` cursor; null until the first full listing finished. */
    pageToken: text("page_token"),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }).defaultNow().notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** A closed code (never provider text or file names). */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("knowledge_source_owner_provider").on(t.ownerUserId, t.provider),
    index("knowledge_source_due_idx").on(t.nextSyncAt),
  ],
);

export const knowledgeDoc = pgTable(
  "knowledge_doc",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSource.id, cascade),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    /** The provider's id for the file (Drive file id). */
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    webViewLink: text("web_view_link"),
    /** Provider revision (Drive `version`): an unchanged file is not read again. */
    version: text("version").notNull().default(""),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    /** pending: new or changed, waiting to be read and chunked. skipped: not readable (type or size). removed: gone or no longer accessible. */
    state: text("state", { enum: ["pending", "indexed", "skipped", "removed"] })
      .default("pending")
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("knowledge_doc_source_external").on(t.sourceId, t.externalId),
    index("knowledge_doc_owner_idx").on(t.ownerUserId, t.state),
  ],
);

export const knowledgeChunk = pgTable(
  "knowledge_chunk",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    docId: uuid("doc_id")
      .notNull()
      .references(() => knowledgeDoc.id, cascade),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    ord: integer("ord").notNull(),
    text: text("text").notNull(),
    /** Null while the embedding model is unavailable: the chunk is still found by keywords and is embedded on a later run. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("knowledge_chunk_doc_ord").on(t.docId, t.ord),
    index("knowledge_chunk_owner_idx").on(t.ownerUserId),
    index("knowledge_chunk_search_idx").using("gin", searchVector(t.text)),
    index("knowledge_chunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

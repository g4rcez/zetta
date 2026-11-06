import { sql, type SQL } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

/**
 * The full-text expression behind global search. Queries and the GIN indexes must use this exact expression, or the index is not used.
 * `f_unaccent` is an immutable wrapper over the unaccent extension (created in the search migration), so accents never block a match.
 */
export const searchVector = (text: SQL | { name: string }) =>
  sql`to_tsvector('simple', f_unaccent(${text}))`;

/** Size of the embedding model's vectors (multilingual-e5-small). Changing the model means changing this and re-embedding. */
export const EMBEDDING_DIMENSIONS = 384;

/** A tsvector column. Only generated columns use it: the database fills it, and a query ranks and matches on it instead of lexing the text again. */
export const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

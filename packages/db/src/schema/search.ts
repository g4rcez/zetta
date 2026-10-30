import { sql, type SQL } from "drizzle-orm";

/**
 * The full-text expression behind global search. Queries and the GIN indexes must use this exact expression, or the index is not used.
 * `f_unaccent` is an immutable wrapper over the unaccent extension (created in the search migration), so accents never block a match.
 */
export const searchVector = (text: SQL | { name: string }) =>
  sql`to_tsvector('simple', f_unaccent(${text}))`;

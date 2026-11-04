import { mentionKey } from "@zetta/core/mentions";
import type { DiffLine, Outcome } from "./types";

/** A name the way a person types it: no @, no spaces, no case. */
export const norm = (v: string) => mentionKey(v.trim().replace(/^@/, ""));

/**
 * Finds one row by id or by name. An id wins; a name that matches two rows is an error that tells the chief to use the id, so a change
 * never lands on the wrong thing.
 */
export function pick<T extends { id: string }>(
  rows: T[],
  query: string,
  nameOf: (row: T) => string,
  what: string,
): { hit: T } | { error: string } {
  const byId = rows.find((r) => r.id === query);
  if (byId) return { hit: byId };
  const wanted = norm(query);
  const named = rows.filter((r) => norm(nameOf(r)) === wanted);
  if (named.length === 1) return { hit: named[0]! };
  if (named.length > 1)
    return { error: `${named.length} ${what}s are called "${query}". Use the id of one of them.` };
  return { error: `no ${what} called "${query}". Use a name or id from the list.` };
}

/** Long text is cut for the card; the full value stays in the patch. */
export const short = (v: unknown, n = 400) =>
  typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v;

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A change that waits for the user's approval. */
export const plan = (
  title: string,
  diff: DiffLine[],
  patch: Record<string, unknown>,
  baseVersion?: number,
): Outcome => ({
  plan: { title, diff, patch, ...(baseVersion !== undefined ? { baseVersion } : {}) },
});

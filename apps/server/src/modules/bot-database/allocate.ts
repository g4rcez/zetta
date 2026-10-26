import type { Database } from "@zetta/db";
import { sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { toSlug, withSuffix } from "./naming";

const conflict = (e: unknown, name: string): boolean => {
  const x = e as { code?: string; constraint?: string; cause?: unknown } | undefined;
  return (x?.code === "23505" && x.constraint === name) || (!!x?.cause && conflict(x.cause, name));
};
export const isUniqueViolation = conflict;

/**
 * Inserts a bot under the first free slug for `name`: `choquei`, then `choquei-2`, `choquei-3`... It starts after the highest taken
 * number and moves along when a concurrent insert takes the same slug first (unique index bot_slug_key).
 */
export async function insertWithSlug<T>(db: Database, name: string, insert: (slug: string) => Promise<T>): Promise<T> {
  const base = toSlug(name);
  const taken = await db.select({ slug: bot.slug }).from(bot).where(sql`${bot.slug} = ${base} or ${bot.slug} ~ ${`^${base}-[0-9]+$`}`);
  const used = new Set(taken.map((r) => r.slug));
  let n = 1; while (used.has(withSuffix(base, n))) n++;
  for (let tries = 0; ; tries++, n++) {
    try { return await insert(withSuffix(base, n)); }
    catch (e) { if (tries >= 20 || !conflict(e, "bot_slug_key")) throw e; }
  }
}

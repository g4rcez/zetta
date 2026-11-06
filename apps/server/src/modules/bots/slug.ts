import type { Database } from "@zetta/db";
import { sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";

/**
 * A bot's friendly-url id (`slug`, kebab-case, unique per installation), set once when the bot is created. The database enforces the
 * same shape (`bot_slug_check`, `bot_slug_key`), so the rules here must stay in step with the `bot` table.
 */
export const SLUG_MAX = 40;
export const SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Turns any display name into a valid slug (never empty). Uniqueness is the caller's job (see `withSuffix`). */
export function toSlug(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "") // "Ação" -> "Acao", "Müller's" -> "Mullers"
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2") // "ChoqueiNews" -> "Choquei-News"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (/.-bot$/.test(s)) s = s.slice(0, -4); // "Choquei Bot" is choquei, not choquei-bot
  if (!s) s = "bot";
  else if (/^[0-9]/.test(s) || s === "pg" || s.startsWith("pg-")) s = `bot-${s}`; // the table check refuses a leading digit or "pg-"
  return cut(s, SLUG_MAX);
}

/** The n-th candidate for a taken slug: `choquei`, `choquei-2`, `choquei-3`... kept within the length limit. */
export const withSuffix = (slug: string, n: number) =>
  n <= 1 ? slug : `${cut(slug, SLUG_MAX - String(n).length - 1)}-${n}`;

function cut(s: string, max: number) {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const dash = head.lastIndexOf("-");
  return (dash >= max / 2 ? head.slice(0, dash) : head).replace(/-+$/, "");
}

const conflict = (e: unknown, name: string): boolean => {
  const x = e as { code?: string; constraint?: string; cause?: unknown } | undefined;
  return (x?.code === "23505" && x.constraint === name) || (!!x?.cause && conflict(x.cause, name));
};
export const isUniqueViolation = conflict;

/**
 * Inserts a bot under the first free slug for `name`: `choquei`, then `choquei-2`, `choquei-3`... It starts after the highest taken
 * number and moves along when a concurrent insert takes the same slug first (unique index bot_slug_key).
 */
export async function insertWithSlug<T>(
  db: Database,
  name: string,
  insert: (slug: string) => Promise<T>,
): Promise<T> {
  const base = toSlug(name);
  const taken = await db
    .select({ slug: bot.slug })
    .from(bot)
    .where(sql`${bot.slug} = ${base} or ${bot.slug} ~ ${`^${base}-[0-9]+$`}`);
  const used = new Set(taken.map((r) => r.slug));
  let n = 1;
  while (used.has(withSuffix(base, n))) n++;
  for (let tries = 0; ; tries++, n++) {
    try {
      return await insert(withSuffix(base, n));
    } catch (e) {
      if (tries >= 20 || !conflict(e, "bot_slug_key")) throw e;
    }
  }
}

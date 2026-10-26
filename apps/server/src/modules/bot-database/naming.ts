/**
 * Names for a bot's database. A bot gets a friendly-url id (`slug`, kebab-case, unique per installation) once, when it is created; its
 * Postgres schema and LOGIN role are both `<slug in snake_case>_bot` ("Choquei" -> slug `choquei` -> `choquei_bot`). Slugs never contain
 * "_", so the snake_case mapping is one-to-one and a unique slug always gives a unique schema. The SQL backfill in the bot-database
 * migration follows the same rules for bots that existed before.
 */
export const SLUG_MAX = 40;
export const SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const IDENT_RE = /^[a-z][a-z0-9_]{0,58}_bot$/;

/** Turns any display name into a valid slug (never empty). Uniqueness is the caller's job (see `withSuffix`). */
export function toSlug(name: string): string {
  let s = name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/['’]/g, "") // "Ação" -> "Acao", "Müller's" -> "Mullers"
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2") // "ChoqueiNews" -> "Choquei-News"
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (/.-bot$/.test(s)) s = s.slice(0, -4); // the schema already ends in _bot: "Choquei Bot" is choquei_bot, not choquei_bot_bot
  if (!s) s = "bot"; else if (/^[0-9]/.test(s) || s === "pg" || s.startsWith("pg-")) s = `bot-${s}`; // pg_ names are reserved by Postgres
  return cut(s, SLUG_MAX);
}

/** The n-th candidate for a taken slug: `choquei`, `choquei-2`, `choquei-3`... kept within the length limit. */
export const withSuffix = (slug: string, n: number) => (n <= 1 ? slug : `${cut(slug, SLUG_MAX - String(n).length - 1)}-${n}`);

/** Schema and role name of a bot. Throws when the slug is not valid, so a bad value can never reach SQL. */
export function schemaFor(slug: string): string {
  if (!SLUG_RE.test(slug) || slug.length > 48 || slug.startsWith("pg-")) throw new Error("INVALID_SLUG");
  return assertIdent(`${slug.replaceAll("-", "_")}_bot`);
}

/** Every identifier interpolated into SQL passes here first (and is double-quoted with `ident`). */
export function assertIdent(s: string): string {
  if (!IDENT_RE.test(s) || s.startsWith("pg_") || Buffer.byteLength(s) > 63) throw new Error("INVALID_IDENTIFIER");
  return s;
}
export const ident = (s: string) => `"${assertIdent(s)}"`;

/** A table or column name the bot created, read back from the catalog: quoted safely for use in a statement. */
export const quoteName = (s: string) => `"${s.replaceAll('"', '""')}"`;

function cut(s: string, max: number) {
  if (s.length <= max) return s;
  const head = s.slice(0, max); const dash = head.lastIndexOf("-");
  return (dash >= max / 2 ? head.slice(0, dash) : head).replace(/-+$/, "");
}

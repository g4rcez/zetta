import { PluginError } from "../integrations/plugins/registry";

const TAB = "the bot's settings > Database";
/** Postgres error codes (SQLSTATE) in plain words. The database's own one-line message is appended so the bot can correct its SQL. */
const BY_STATE: Record<string, [code: string, safe: string, fix: string]> = {
  "42P01": ["DB_NOT_FOUND", "That table does not exist (yet).", "Ask the bot to look at what it has saved (db_overview) and create the table first."],
  "42703": ["DB_NOT_FOUND", "That column does not exist.", "Ask the bot to check its tables (db_overview) and try again."],
  "42501": ["DB_FORBIDDEN", "A bot can only use its own database; everything else is off limits.", "Nothing to fix: ask the bot to keep to its own tables."],
  "23505": ["DB_DUPLICATE", "That entry already exists.", "Ask the bot to update the existing entry instead of adding it again."],
  "23502": ["DB_INVALID", "A required value was missing.", "Tell the bot the missing detail so it can save the entry."],
  "23503": ["DB_INVALID", "The entry points to something that does not exist.", "Ask the bot to check the related entry first."],
  "23514": ["DB_INVALID", "A value did not pass the table's rules.", "Tell the bot what you meant so it can save a valid value."],
  "22P02": ["DB_INVALID", "A value had the wrong format (for example text where a number was expected).", "Tell the bot the exact value you want saved."],
  "22007": ["DB_INVALID", "A date or time had the wrong format.", "Tell the bot the date in a clear form, for example 2026-10-30 15:00."],
  "42601": ["DB_SYNTAX", "The bot wrote a database command with a mistake in it.", "Ask the bot to try again."],
  "42P07": ["DB_DUPLICATE", "That table already exists.", "Ask the bot to reuse the existing table (db_overview shows it)."],
  "25006": ["DB_READ_ONLY", "Reading tools cannot change data.", "Ask the bot to save it again (it must use db_execute to change data)."],
  "57014": ["TIMEOUT", "The database command took too long and was stopped.", "Ask the bot for something smaller, or to add an index."],
  "25P02": ["TIMEOUT", "An earlier step failed, so the rest was not run.", "Ask the bot to try again one step at a time."],
  "53100": ["QUOTA", "The bot's database is full.", `Ask the bot to delete old entries, or use Start over in ${TAB}.`],
  "54000": ["TOO_LARGE", "The request was too large for the database.", "Ask the bot for a smaller piece."],
  "40P01": ["RATE_LIMITED", "Two changes collided.", "Ask the bot to try again."],
  "55P03": ["RATE_LIMITED", "The data is busy with another change.", "Ask the bot to try again in a moment."],
};

const oneLine = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 200) : "");

/** Converts a driver error into an explained PluginError. Unknown database errors keep their class (first two SQLSTATE chars) only. */
export function dbError(e: unknown): PluginError {
  if (e instanceof PluginError) return e;
  const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "";
  const said = oneLine((e as Error | undefined)?.message);
  const hit = BY_STATE[code];
  if (hit) return new PluginError(hit[0], said ? `${hit[1]} The database said: ${said}.` : hit[1], hit[2]);
  if (/^(08|57P0|53)/.test(code) || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(String((e as { code?: unknown })?.code))) return new PluginError("UNREACHABLE", "The bot's database could not be reached.", "Try again in a moment. If it keeps failing, ask the administrator to check the database server.");
  if (/^(22|23|42)/.test(code)) return new PluginError("DB_INVALID", said ? `The database refused the command. It said: ${said}.` : "The database refused the command.", "Tell the bot exactly what you want so it can fix the command.");
  return new PluginError("FAILED");
}

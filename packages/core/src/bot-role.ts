/** The longest `bot.role` the API accepts and the database stores. */
export const BOT_ROLE_MAX = 60;
/** A line taken from the description is cut to this many characters, with an ellipsis. */
export const BOT_ROLE_FALLBACK_MAX = 80;

type RoleSource = {
  role?: string | null;
  description?: string | null;
  kind?: "chief" | "specialist";
};

const firstLine = (text: string | null | undefined) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * The one short line that says what a bot is for, shown beside its name wherever a bot is chosen. In order: the role the owner wrote;
 * the title of the organization seat the bot holds (the caller looks it up and passes it); the first line of the description, cut to 80
 * characters; and last the kind, `Chief` or `Specialist`.
 */
export function botRole(bot: RoleSource, seatTitle?: string | null): string {
  const role = bot.role?.trim();
  if (role) return role;
  const seat = seatTitle?.trim();
  if (seat) return seat;
  const line = firstLine(bot.description);
  if (line) return clip(line, BOT_ROLE_FALLBACK_MAX);
  return bot.kind === "chief" ? "Chief" : "Specialist";
}

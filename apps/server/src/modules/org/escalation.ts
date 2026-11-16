import { nearestManager } from "@zetta/core/org";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { readOrg } from "./store";

type Bot = typeof bot.$inferSelect;

/** Where a blocked bot's request for help goes, by the company chart. `manager` is a bot that takes the Chief's place in the help room. */
export type EscalationRoute = { manager: Bot | undefined; note: string };

const NONE: EscalationRoute = { manager: undefined, note: "" };
/** The admin wrote these names: one line, no fences, a limit. */
const line = (t: string, max = 80) =>
  t.replaceAll("```", "'''").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The company chart says who a stuck bot asks first: its nearest manager that is actually there.
 * - A manager that is a bot (shared with the team, ready, not archived) hears it instead of the Chief.
 * - A manager that is another person is named in the request, so whoever answers knows who must act. Nothing of the chat goes to them.
 * - No seat, a manager that is the user themselves, or no manager above: nothing changes, the Chief hears it.
 * The chart only decides who should hear. What each one may see or approve is still decided by who owns it.
 */
export async function escalationRoute(
  db: Pick<Database, "select">,
  userId: string,
  who: { id: string; name: string },
): Promise<EscalationRoute> {
  const { positions } = await readOrg(db, userId);
  const seat = positions.find((p) => p.holder?.kind === "bot" && p.holder.botId === who.id);
  if (!seat) return NONE;
  const above = nearestManager(positions, seat.id);
  const holder = above?.holder;
  if (!above || !holder) return NONE;
  if (holder.kind === "bot") {
    if (holder.botId === who.id) return NONE;
    const [row] = await db
      .select()
      .from(bot)
      .where(
        and(
          eq(bot.id, holder.botId),
          eq(bot.archived, false),
          eq(bot.onboarded, true),
          eq(bot.visibility, "team"),
        ),
      );
    return row
      ? {
          manager: row,
          note: `The company chart says ${line(who.name)} reports to ${line(row.name)} (${line(above.title)}), so the request went to them first.`,
        }
      : NONE;
  }
  if (holder.userId === userId) return NONE;
  return {
    manager: undefined,
    note: `The company chart says ${line(who.name)} reports to ${line(holder.name)} (${line(above.title)}). If a person must act, they are the first to ask: name them in the handoff.`,
  };
}

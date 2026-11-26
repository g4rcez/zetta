// Who a person's Chief is. It is a bot of their own (kind `chief`), unless someone who administers their workspace shared one of their
// bots with them as their Chief (`chief_share`): then it is that bot, which stays its owner's.
import type { Database } from "@zetta/db";
import { and, asc, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { chiefShare } from "@zetta/db/schema/workspaces";

type Reader = Pick<Database, "select">;

/** The ids of the bots shared with this person as their Chief, as a subquery for `inArray(bot.id, ...)`. At most one row. */
export const sharedChiefIds = (db: Reader, userId: string) =>
  db.select({ id: chiefShare.botId }).from(chiefShare).where(eq(chiefShare.userId, userId));

/** The bot someone shared with this person as their Chief. An archived bot is nobody's Chief. */
export async function sharedChiefOf(db: Reader, userId: string) {
  const [shared] = await db
    .select({ bot })
    .from(chiefShare)
    .innerJoin(bot, eq(bot.id, chiefShare.botId))
    .where(and(eq(chiefShare.userId, userId), eq(bot.archived, false)))
    .limit(1);
  return shared?.bot;
}

/** This person's Chief: the shared one when there is one, else their own. Undefined when they have neither yet. */
export async function chiefFor(db: Reader, userId: string) {
  const shared = await sharedChiefOf(db, userId);
  if (shared) return shared;
  const [own] = await db
    .select()
    .from(bot)
    .where(and(eq(bot.ownerUserId, userId), eq(bot.kind, "chief"), eq(bot.archived, false)))
    .orderBy(asc(bot.createdAt))
    .limit(1);
  return own;
}

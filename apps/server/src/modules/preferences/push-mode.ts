import { DEFAULT_PUSH_MODE, type PushMode } from "@zetta/core/push";
import type { Database } from "@zetta/db";
import { inArray } from "@zetta/db/query";
import { userPreference } from "@zetta/db/schema/preferences";

/**
 * The push choice of each person in `userIds`. A person with no preference row never chose: `DEFAULT_PUSH_MODE`. The sender calls this
 * once per event, with everyone the event is for, and then `pushAllows(mode, eventClass)` from `@zetta/core/push`.
 */
export async function pushModesFor(
  db: Pick<Database, "select">,
  userIds: readonly string[],
): Promise<Map<string, PushMode>> {
  const modes = new Map<string, PushMode>(userIds.map((id) => [id, DEFAULT_PUSH_MODE]));
  if (userIds.length === 0) return modes;
  const rows = await db
    .select({ id: userPreference.ownerUserId, mode: userPreference.pushMode })
    .from(userPreference)
    .where(inArray(userPreference.ownerUserId, [...userIds]));
  for (const r of rows) modes.set(r.id, r.mode);
  return modes;
}

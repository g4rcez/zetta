import type { Database } from "@zetta/db";
import { and, eq, isNull } from "@zetta/db/query";
import { installationSettings } from "@zetta/db/schema/installation";

export type PushKeyRecord = { publicKey: string; connectionId: string };

/**
 * Records the installation's VAPID key pair, once. The first process that generates a pair wins; a second one (an `api` and a `worker`
 * starting together, or two requests) loses and must use what is stored. The compare-and-set is one statement, so it holds across
 * processes without a lock, and it writes only the two push columns: a concurrent change of another setting is not overwritten.
 *
 * The caller creates the sealed connection of the private key first, then calls this. On `claimed: false` it revokes the connection it
 * just made and uses `current`.
 */
export async function claimPushKeys(
  db: Pick<Database, "insert" | "update" | "select">,
  keys: PushKeyRecord,
): Promise<{ claimed: true } | { claimed: false; current: PushKeyRecord | null }> {
  // The settings are a singleton row that may not exist yet (the defaults apply): create it with its defaults, never change it.
  await db.insert(installationSettings).values({ id: 1 }).onConflictDoNothing();
  const won = await db
    .update(installationSettings)
    .set({
      pushPublicKey: keys.publicKey,
      pushConnectionId: keys.connectionId,
      updatedAt: new Date(),
    })
    .where(and(eq(installationSettings.id, 1), isNull(installationSettings.pushPublicKey)))
    .returning({ id: installationSettings.id });
  if (won.length === 1) return { claimed: true };
  return { claimed: false, current: await currentPushKeys(db) };
}

/** The recorded pair, or null when none was generated yet. */
export async function currentPushKeys(db: Pick<Database, "select">): Promise<PushKeyRecord | null> {
  const [row] = await db
    .select({
      publicKey: installationSettings.pushPublicKey,
      connectionId: installationSettings.pushConnectionId,
    })
    .from(installationSettings)
    .where(eq(installationSettings.id, 1));
  return row?.publicKey && row.connectionId
    ? { publicKey: row.publicKey, connectionId: row.connectionId }
    : null;
}

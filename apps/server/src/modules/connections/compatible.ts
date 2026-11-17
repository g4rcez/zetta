import {
  COMPATIBLE_PROVIDER,
  parseCompatibleConfig,
  type CompatibleConfig,
  type CompatibleConfigIssue,
  type HostKind,
} from "@zetta/core/model-server";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { connection } from "@zetta/db/schema/connections";

/**
 * The non-secret settings of a connection of provider `compatible` (a model on the person's own server): `connection.config`. The sealed
 * secret (the key, or the no-key placeholder) is read through `connections.secretFor` like any other. These two helpers only touch the
 * `config` column, so the credential store and its strict metadata stay as they were.
 */

/**
 * Saves the config of one of the person's own `compatible` connections. The caller has already applied the address rule with
 * `parseCompatibleConfig` (it knows who the person is); this only writes. False when the connection is not theirs, not `compatible`, or
 * not active.
 */
export async function writeCompatibleConfig(
  db: Pick<Database, "update">,
  ownerUserId: string,
  connectionId: string,
  config: CompatibleConfig,
): Promise<boolean> {
  const rows = await db
    .update(connection)
    .set({ config: { baseUrl: config.baseUrl, model: config.model } })
    .where(
      and(
        eq(connection.id, connectionId),
        eq(connection.ownerUserId, ownerUserId),
        eq(connection.provider, COMPATIBLE_PROVIDER),
        eq(connection.state, "active"),
      ),
    )
    .returning({ id: connection.id });
  return rows.length === 1;
}

export type CompatibleRead =
  | { ok: true; config: CompatibleConfig; hostKind: HostKind }
  | { ok: false; reason: "not_found" | CompatibleConfigIssue };

/**
 * Reads the config of one of the person's own active `compatible` connections and applies the address rule again, now: who may reach a
 * local address can change (an administrator loses the role, the operator turns the setting off), so a saved address is never trusted.
 */
export async function readCompatibleConfig(
  db: Pick<Database, "select">,
  ownerUserId: string,
  connectionId: string,
  o: { allowLocal: boolean },
): Promise<CompatibleRead> {
  const [row] = await db
    .select({ config: connection.config })
    .from(connection)
    .where(
      and(
        eq(connection.id, connectionId),
        eq(connection.ownerUserId, ownerUserId),
        eq(connection.provider, COMPATIBLE_PROVIDER),
        eq(connection.state, "active"),
      ),
    );
  if (!row) return { ok: false, reason: "not_found" };
  const parsed = parseCompatibleConfig(row.config, o);
  return parsed.ok
    ? { ok: true, config: parsed.config, hostKind: parsed.hostKind }
    : { ok: false, reason: parsed.error };
}

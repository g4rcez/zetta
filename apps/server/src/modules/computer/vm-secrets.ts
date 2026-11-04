import type { ConnectionsService } from "../connections/service";
import type { ActiveActor } from "../identity/access";
import { ComputerError } from "./service";
import type { VmSecrets } from "./vm";

export const COMPUTER_PROVIDER = "machine";

/**
 * The bearer token of a remote Cua computer, kept as a sealed `connection` (the same store and write-only rules as machine keys and
 * plugin secrets). The VM service works with user ids, so each call gets a fresh background actor, re-checked against membership.
 */
export function vmSecretsFrom(
  /** A getter: the VM service is built before the connections service, and only calls it later. */
  connectionsOf: () => ConnectionsService,
  actorFor: (userId: string) => Promise<ActiveActor | null>,
): VmSecrets {
  const connections = {
    create: (...a: Parameters<ConnectionsService["create"]>) => connectionsOf().create(...a),
    secretFor: (...a: Parameters<ConnectionsService["secretFor"]>) =>
      connectionsOf().secretFor(...a),
    list: (...a: Parameters<ConnectionsService["list"]>) => connectionsOf().list(...a),
    revoke: (...a: Parameters<ConnectionsService["revoke"]>) => connectionsOf().revoke(...a),
  };
  const actor = async (userId: string) => {
    const a = await actorFor(userId);
    if (!a) throw new ComputerError("REVOKED");
    return a;
  };
  return {
    async create(userId, label, secret) {
      const c = await connections.create(await actor(userId), {
        provider: COMPUTER_PROVIDER,
        label: `computer:${label}`.slice(0, 100),
        secret,
      });
      return c.id;
    },
    async read(userId, connectionId) {
      const buf = await connections
        .secretFor(await actor(userId), connectionId)
        .catch(() => undefined);
      if (!buf) throw new ComputerError("REVOKED");
      try {
        return buf.toString("utf8");
      } finally {
        buf.fill(0);
      }
    },
    async revoke(userId, connectionId) {
      const a = await actor(userId);
      const c = (await connections.list(a)).find((x) => x.id === connectionId);
      if (c) await connections.revoke(a, connectionId, c.revision);
    },
  };
}

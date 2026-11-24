import type { ActiveActor } from "../identity/access";
import type { ConnectionsService } from "./service";

/** `none`: no key. `set`: a saved key that can be read. `unavailable`: a key was saved but cannot be read any more. A key is only ever a sealed connection, never an environment variable. */
export type InstallationKeyState = "none" | "set" | "unavailable";

/**
 * Read access to a key of the whole installation (speech out, push): a sealed connection that one administrator saved, whose id the
 * installation settings record. Read-only, and the same in every `ZETTA_ROLE`: an `api` and a `worker` process share the database and
 * the same `ZETTA_CONNECTION_KEY`, so both open it. There is no signed-in administrator when a worker sends a push or a voice note is
 * spoken, so the key is read through the connection's owner (a background actor whose membership is checked on every call).
 */
export type InstallationKeyReader = {
  state(connectionId: string | null): Promise<InstallationKeyState>;
  /** The key as bytes (the caller zeroes them), or undefined when there is none to use. Never throws for a missing key. */
  secret(connectionId: string | null): Promise<Buffer | undefined>;
};

export function createInstallationKeyReader(deps: {
  /** The owner of a connection, from its row. */
  owner(connectionId: string): Promise<string | undefined>;
  /** A background actor for that owner, or null when they are no longer a member. */
  actorFor(userId: string): Promise<ActiveActor | null>;
  connections: Pick<ConnectionsService, "list" | "secretFor">;
}): InstallationKeyReader {
  const actor = async (id: string) => {
    const owner = await deps.owner(id).catch(() => undefined);
    return owner ? await deps.actorFor(owner).catch(() => null) : null;
  };
  return {
    async state(id) {
      if (!id) return "none";
      const a = await actor(id);
      if (!a) return "unavailable";
      const mine = (await deps.connections.list(a).catch(() => [])).find((c) => c.id === id);
      return mine?.state === "active" ? "set" : "unavailable";
    },
    async secret(id) {
      if (!id) return undefined;
      const a = await actor(id);
      if (!a) return undefined;
      // `secretFor` hands over a buffer the caller owns and zeroes.
      try {
        const secret = await deps.connections.secretFor(a, id);
        return secret.length ? secret : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

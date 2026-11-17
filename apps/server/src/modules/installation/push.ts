import type { InstallationKeyReader, InstallationKeyState } from "../connections/installation-key";
import type { InstallationSettings } from "./service";

/**
 * What the push feature reads: the public VAPID key (public by design, for the browser) and the private one (sealed, for the sender).
 * Read-only and the same in every `ZETTA_ROLE`: the pair is generated once at first use (`claimPushKeys`), and an `api` and a `worker`
 * process both read it from the database. Both are null/undefined until then.
 */
export function createPushReader(deps: {
  load: () => Promise<InstallationSettings>;
  key: InstallationKeyReader;
}) {
  return {
    publicKey: async (): Promise<string | null> => (await deps.load()).pushPublicKey,
    keyState: async (): Promise<InstallationKeyState> =>
      deps.key.state((await deps.load()).pushConnectionId),
    /** The private key as bytes (the caller zeroes them), or undefined when none was generated or it cannot be read. */
    privateKey: async (): Promise<Buffer | undefined> => {
      const { pushConnectionId } = await deps.load();
      return pushConnectionId ? deps.key.secret(pushConnectionId) : undefined;
    },
  };
}
export type PushReader = ReturnType<typeof createPushReader>;

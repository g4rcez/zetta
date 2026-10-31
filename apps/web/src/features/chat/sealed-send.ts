import { seal, type SealedPayload, type TransportPublicKey } from "@zetta/core/sealed-transport";

export type PublishedTransportKey = {
  kid: string;
  publicKey: TransportPublicKey;
  userId: string;
  serverTime: number;
};

/**
 * Seals a credential payload to the server's transport key and passes it to `send`, so the raw token never appears in a request body.
 * The key is fetched fresh for every send: sealing is rare, and a fresh key avoids stale caches, a user switch and clock skew
 * (the payload is stamped with the server's clock). If the key rotated between the fetch and the request, it retries once.
 * It never falls back to plaintext.
 */
export function createSealedSend(getKey: () => Promise<PublishedTransportKey>) {
  return async function sealedSend<T>(
    purpose: string,
    payload: object,
    send: (sealed: SealedPayload) => Promise<T>,
  ): Promise<T> {
    if (!globalThis.crypto?.subtle)
      throw new Error(
        "This page cannot encrypt credentials. Open Zetta over HTTPS or on localhost.",
      );
    const attempt = async () => {
      const key = await getKey();
      return send(
        await seal(
          key.publicKey,
          key.kid,
          payload,
          { userId: key.userId, purpose },
          key.serverTime,
        ),
      );
    };
    try {
      return await attempt();
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "TRANSPORT_KEY_EXPIRED") return attempt();
      throw error;
    }
  };
}

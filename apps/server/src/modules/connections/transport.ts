import { uuidv7 } from "@zetta/core/uuid";
import {
  generateTransportKeyPair,
  open,
  type TransportContext,
  type TransportPublicKey,
} from "@zetta/core/sealed-transport";

const rotateAfterMs = 60 * 60_000;
const graceMs = 5 * 60_000;

/** The key id is unknown or retired: the client must fetch the published key again and seal once more. */
export class TransportKeyExpiredError extends Error {
  constructor() {
    super("transport-key-expired");
    this.name = "TransportKeyExpiredError";
  }
}

type Entry = {
  kid: string;
  publicKey: TransportPublicKey;
  privateKey: CryptoKey;
  createdAt: number;
  retiredAt?: number;
};

/**
 * The server half of the sealed credential transport. Keys live only in memory and are non-extractable, so a restart
 * retires them: a client that sealed before the restart gets `TransportKeyExpiredError` and retries once. A retired key
 * keeps opening payloads for a short grace so a request in flight during a rotation does not fail.
 */
export function createTransportKeyring(now: () => number = Date.now) {
  let current: Entry | undefined;
  let previous: Entry | undefined;
  let pending: Promise<Entry> | undefined;

  async function rotate(): Promise<Entry> {
    const pair = await generateTransportKeyPair();
    return {
      kid: `k${uuidv7().slice(-12)}`,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      createdAt: now(),
    };
  }

  async function active(): Promise<Entry> {
    if (current && now() - current.createdAt < rotateAfterMs) return current;
    // Concurrent callers share one rotation: two keys for the same moment would race the grace window.
    pending ??= rotate().finally(() => {
      pending = undefined;
    });
    const next = await pending;
    if (current !== next && next !== previous) {
      if (current) previous = { ...current, retiredAt: current.createdAt + rotateAfterMs }; // the grace runs from the real expiry, not from when we noticed it
      current = next;
    }
    return current ?? next;
  }

  return Object.freeze({
    async publicKey() {
      const entry = await active();
      return {
        kid: entry.kid,
        publicKey: entry.publicKey,
        expiresAt: entry.createdAt + rotateAfterMs,
      };
    },
    async open(sealed: unknown, context: TransportContext): Promise<unknown> {
      await active();
      const kid =
        typeof sealed === "object" && sealed !== null
          ? (sealed as { kid?: unknown }).kid
          : undefined;
      const withinGrace =
        previous?.retiredAt !== undefined && now() - previous.retiredAt <= graceMs;
      const entry =
        current?.kid === kid
          ? current
          : previous?.kid === kid && withinGrace
            ? previous
            : undefined;
      if (!entry) throw new TransportKeyExpiredError();
      return open(entry.privateKey, sealed, context, now());
    },
  });
}

export type TransportKeyring = ReturnType<typeof createTransportKeyring>;
/** The process-wide keyring shared by every route that accepts a sealed body. */
export const transportKeyring = createTransportKeyring();

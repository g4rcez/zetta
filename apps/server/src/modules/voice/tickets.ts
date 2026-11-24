import { randomBytes } from "node:crypto";
import { VOICE_LIMITS } from "./protocol";

/**
 * One-time tickets for the voice socket. A browser sends no custom header on a WebSocket, so the credential is a ticket made by an
 * authenticated, origin-checked POST: single use, valid for a few seconds, kept in memory of the process that serves the socket (the
 * ticket and the socket routes both go to the worker, see worker-only.ts).
 */
export type TicketStore<T> = {
  mint(info: T): string;
  /** The info of a valid ticket, once: a second redeem, an unknown or an expired ticket gives null. */
  redeem(ticket: string): T | null;
  readonly size: number;
};

export function createTicketStore<T>(
  opts: { ttlMs?: number; now?: () => number; max?: number } = {},
): TicketStore<T> {
  const ttl = opts.ttlMs ?? VOICE_LIMITS.ticketMs;
  const now = opts.now ?? Date.now;
  const max = opts.max ?? 1000;
  const tickets = new Map<string, { info: T; expires: number }>();
  const sweep = () => {
    const t = now();
    for (const [k, v] of tickets) if (v.expires <= t) tickets.delete(k);
  };
  return {
    mint(info) {
      sweep();
      // A flood of tickets cannot grow the map without end: the oldest goes first.
      while (tickets.size >= max) tickets.delete(tickets.keys().next().value as string);
      const ticket = randomBytes(24).toString("base64url");
      tickets.set(ticket, { info, expires: now() + ttl });
      return ticket;
    },
    redeem(ticket) {
      const t = tickets.get(ticket);
      tickets.delete(ticket);
      if (!t || t.expires <= now()) return null;
      return t.info;
    },
    get size() {
      return tickets.size;
    },
  };
}

/** At most `limit` events per person per minute. */
export function createPerMinute(limit: number, now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return {
    /** True when this one is allowed (and counted). */
    take(key: string): boolean {
      const t = now();
      const recent = (seen.get(key) ?? []).filter((x) => t - x < 60_000);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return false;
      }
      seen.set(key, [...recent, t]);
      return true;
    },
  };
}

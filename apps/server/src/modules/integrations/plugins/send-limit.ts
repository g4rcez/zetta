/**
 * Sliding-window limit on outward actions, per key (a user id). In memory, so it resets on restart.
 * `allow` records the action only when it is allowed, so a refused call does not count.
 */
export function createSendLimit({ perHour, perMin }: { perHour: number; perMin?: number }) {
  const log = new Map<string, number[]>();
  return {
    allow(key: string, now = Date.now()) {
      const recent = (log.get(key) ?? []).filter((t) => now - t < 3_600_000);
      if (recent.length >= perHour) return false;
      if (perMin !== undefined && recent.filter((t) => now - t < 60_000).length >= perMin)
        return false;
      recent.push(now);
      log.set(key, recent);
      return true;
    },
    /** Test helper. */
    reset: () => log.clear(),
  };
}

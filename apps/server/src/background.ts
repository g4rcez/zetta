type Log = (line: string) => void;

/**
 * Runs the server's background units (tickers, recovery, sweeps). A unit that fails never throws into the timer and never goes silent:
 * its failure is logged with the unit's name and the error's class name (not its message, which can hold user data), at most once a
 * minute per unit so a unit that fails on every tick does not flood the log.
 */
export function createBackground(log: Log = console.error, now: () => number = Date.now) {
  const QUIET_MS = 60_000;
  const lastLogged = new Map<string, number>();
  const running = new Set<string>();
  const report = (name: string, e: unknown) => {
    const at = now();
    if (at - (lastLogged.get(name) ?? -Infinity) < QUIET_MS) return;
    lastLogged.set(name, at);
    log(`background: ${name} failed name=${(e as Error | undefined)?.name ?? typeof e}`);
  };
  /** Resolves true when the unit ran to the end, false when it failed. Never rejects. */
  async function run(name: string, unit: () => unknown): Promise<boolean> {
    try {
      await unit();
      return true;
    } catch (e) {
      report(name, e);
      return false;
    }
  }
  return {
    run,
    /** Like `run`, but a call that arrives while the unit is still going is skipped (resolves false, logs nothing). */
    async exclusive(name: string, unit: () => unknown): Promise<boolean> {
      if (running.has(name)) return false;
      running.add(name);
      try {
        return await run(name, unit);
      } finally {
        running.delete(name);
      }
    },
  };
}

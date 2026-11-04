/** For data that rarely changes (bots, teams, plugin catalog, installation): no refetch on focus, and a write invalidates the key. */
export const STATIC = { staleTime: 5 * 60_000, refetchOnWindowFocus: false } as const;

let live = false;
/** Set by `lib/live-events.ts`: true while the live channel is open, so the server tells the page when something changes. */
export const setLive = (connected: boolean) => {
  live = connected;
};
export const isLive = () => live;

/**
 * `refetchInterval` value: `fast` while something is happening, `slow` otherwise (`false` stops the poll).
 * Pass `active` from the data the query already holds, for example a running turn.
 * While the live channel is open the poll is only a safety net: a missed event costs at most 15 s (active) or 60 s.
 */
export const pollEvery = (fast: number, slow: number | false, active: boolean) => {
  const every = active ? fast : slow;
  return live && every !== false ? Math.max(every, active ? 15_000 : 60_000) : every;
};

/**
 * A poke tells the reply that is running for a turn that something was sent to it, so a run that can read a message while it works
 * (see `streamCli`) does so now instead of at its next step. It is only a hint: a lost poke loses nothing, because the message stays
 * saved and is read before the reply closes, or answered by the next turn.
 *
 * Keyed by the turn's abort signal, which every layer of a run already holds, so nothing has to pass a handle down.
 */
const listeners = new WeakMap<AbortSignal, Set<() => void>>();

/** Calls `wake` whenever the turn of `signal` is poked. Returns the function that stops listening. */
export function onPoke(signal: AbortSignal, wake: () => void): () => void {
  const set = listeners.get(signal) ?? new Set<() => void>();
  listeners.set(signal, set);
  set.add(wake);
  return () => {
    set.delete(wake);
  };
}

/** Wakes whatever listens on the turn of `signal`. True when something did. */
export function poke(signal: AbortSignal): boolean {
  const set = listeners.get(signal);
  if (!set?.size) return false;
  // A listener may stop listening while it runs, so the loop runs on a copy.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const wake of [...set]) wake();
  return true;
}

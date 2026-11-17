import { useSyncExternalStore } from "react";

const QUERY = "(hover: none)";

const listeners = new Set<() => void>();
let list: MediaQueryList | undefined;
const notify = () => listeners.forEach((l) => l());

/** One listener for every row of a long history: the first subscriber opens it, the last one closes it. */
function subscribe(listener: () => void) {
  if (!listeners.size) {
    list = window.matchMedia(QUERY);
    list.addEventListener("change", notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      list?.removeEventListener("change", notify);
      list = undefined;
    }
  };
}

/**
 * True on a screen whose main pointer cannot hover (a phone, a tablet): the hover toolbar never shows there, so a message offers a
 * visible "More" button instead. The server render assumes a pointer that hovers.
 */
export const useTouchScreen = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );

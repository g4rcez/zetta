import { useSyncExternalStore } from "react";

const subscribe = (query: string) => (notify: () => void) => {
  const m = window.matchMedia(query);
  m.addEventListener("change", notify);
  return () => m.removeEventListener("change", notify);
};

/** True while the media query matches. The server render assumes a wide screen. */
export const useMedia = (query: string) =>
  useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => true,
  );

import { useEffect, useRef } from "react";

/**
 * A message the running reply did not read is answered by a turn the server starts when that reply ends: follow that answer live and
 * refresh until none waits.
 */
export function useFollowQueued(
  chatId: string | undefined,
  waiting: boolean,
  main: { busy: boolean; reattach: () => void },
  reload: (id: string) => unknown,
) {
  const follow = useRef(main);
  follow.current = main;
  useEffect(() => {
    if (!chatId || !waiting || main.busy) return;
    follow.current.reattach();
    const t = setInterval(() => {
      if (document.hidden) return; // a hidden tab catches up when it is visible again
      void reload(chatId);
      follow.current.reattach();
    }, 2_000);
    return () => clearInterval(t);
  }, [chatId, waiting, main.busy, reload]);
}

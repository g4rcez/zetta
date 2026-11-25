import { useEffect, useRef } from "react";

import { pollEvery } from "@/lib/query-policy";

/**
 * A message the running reply did not read is answered by a turn the server starts when that reply ends: follow that answer live and
 * refresh until none waits.
 *
 * Every queue transition publishes `conversation:<id>` on the live channel, so the messages refetch by themselves; `messagesUpdatedAt`
 * (the messages query's `dataUpdatedAt`) moves with each of them and re-attaches the stream to the turn that just started. The timer is
 * only the safety net: 2 s without the channel, 15 s with it.
 */
export function useFollowQueued(
  chatId: string | undefined,
  waiting: boolean,
  main: { busy: boolean; reattach: () => void },
  reload: (id: string) => unknown,
  messagesUpdatedAt: number,
) {
  const follow = useRef(main);
  follow.current = main;
  useEffect(() => {
    if (!chatId || !waiting || main.busy) return;
    follow.current.reattach();
    // `pollEvery` is only `false` for a `false` slow value; here both are numbers.
    const every = pollEvery(2_000, 2_000, true) || 2_000;
    const t = setInterval(() => {
      if (document.hidden) return; // a hidden tab catches up when it is visible again
      void reload(chatId);
      follow.current.reattach();
    }, every);
    return () => clearInterval(t);
  }, [chatId, waiting, main.busy, reload]);
  // The channel told the page that something moved (the next queued answer started): follow it without waiting for the timer.
  const seen = useRef(messagesUpdatedAt);
  useEffect(() => {
    if (seen.current === messagesUpdatedAt) return;
    seen.current = messagesUpdatedAt;
    if (!chatId || !waiting || follow.current.busy) return;
    follow.current.reattach();
  }, [chatId, waiting, messagesUpdatedAt]);
}

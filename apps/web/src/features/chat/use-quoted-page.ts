import { useCallback, useEffect, useMemo, useState } from "react";

import { chatClient, type Message } from "./chat-client";
import { showMessage } from "./message-row";

/** Both lists by `seq`, with a message that is in both kept once (the newest page wins). */
export function mergeMessages(older: readonly Message[], loaded: readonly Message[]): Message[] {
  if (!older.length) return loaded as Message[];
  const byId = new Map(older.map((m) => [m.id, m]));
  for (const m of loaded) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * A quote points at a message that may be older than the page the list loaded. Clicking it scrolls there when it is on the page; when it
 * is not, this fetches the messages around it (up to where the loaded page begins), adds them to the list and then scrolls and flashes it.
 * The older messages stay while the conversation is open: the live refetches only replace the newest page.
 */
export function useQuotedPage({
  conversationId,
  loaded,
  onError,
}: {
  conversationId: string | undefined;
  loaded: readonly Message[];
  onError?: (e: unknown) => void;
}) {
  const [older, setOlder] = useState<Message[]>([]);
  const [target, setTarget] = useState<string>();
  useEffect(() => {
    setOlder([]);
    setTarget(undefined);
  }, [conversationId]);
  const messages = useMemo(() => mergeMessages(older, loaded), [older, loaded]);
  // The page arrives, the rows draw, and then the message is in the document.
  useEffect(() => {
    if (target && document.getElementById(`message-${target}`)) {
      showMessage(target);
      setTarget(undefined);
    }
  }, [target, messages]);
  const show = useCallback(
    (id: string) => {
      if (document.getElementById(`message-${id}`) || !conversationId) return showMessage(id);
      const oldest = messages.reduce((n, m) => Math.min(n, m.seq), Number.MAX_SAFE_INTEGER);
      chatClient.messagesAround(conversationId, id, oldest).then(
        (page) => {
          setOlder((prev) => mergeMessages(prev, page));
          setTarget(id);
        },
        (e) => onError?.(e),
      );
    },
    [conversationId, messages, onError],
  );
  /** A message edited while it is in the older part. */
  const replace = useCallback(
    (edited: Message) =>
      setOlder((prev) => prev.map((m) => (m.id === edited.id ? { ...m, ...edited } : m))),
    [],
  );
  return { messages, show, replace };
}

import { useQueryClient } from "@tanstack/react-query";

import { chatClient, type Message } from "./chat-client";
import { chatQueries } from "./chat-queries";
import type { Row } from "./chat-rows";
import { toggleReaction } from "./reactions";

/** Adds or takes back the person's reaction on a message: shown at once, put back when the server refuses. */
export function useReactions(chatId: string | undefined, fail: (e: unknown) => void) {
  const qc = useQueryClient();
  const setReactions = (id: string, reactions: Message["reactions"]) =>
    qc.setQueryData<Message[]>(chatQueries.messages(chatId ?? "").queryKey, (l) =>
      l?.map((m) => (m.id === id ? { ...m, reactions } : m)),
    );
  return async function toggleReact(m: Row, emoji: string) {
    const before = m.reactions ?? [],
      wasMine = before.some((r) => r.emoji === emoji && r.mine);
    setReactions(m.id, toggleReaction(before, emoji));
    try {
      await (wasMine ? chatClient.unreact(m.id, emoji) : chatClient.react(m.id, emoji));
    } catch (e) {
      setReactions(m.id, before);
      fail(e);
    }
  };
}

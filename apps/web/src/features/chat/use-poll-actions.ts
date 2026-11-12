import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { chatClient, type Message } from "./chat-client";
import { chatQueries } from "./chat-queries";
import type { Row } from "./chat-rows";
import { applyVote } from "./poll-votes";

/**
 * The two things a person does to a poll: vote (their whole choice) and close it. A vote shows at once and is put back when the server
 * refuses it; the live "conversation changed" signal brings in everyone else's. Closing reloads the messages.
 */
export function usePollActions(
  conversationId: string | undefined,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const vote = useCallback(
    (row: Row, options: string[]) => {
      if (!conversationId) return;
      const key = chatQueries.messages(conversationId).queryKey;
      const before = qc.getQueryData<Message[]>(key);
      qc.setQueryData<Message[]>(key, (list) =>
        list?.map((m) =>
          m.id === row.id ? { ...m, pollVotes: applyVote(m.pollVotes ?? {}, options) } : m,
        ),
      );
      chatClient.votePoll(conversationId, row.id, options).catch((e: unknown) => {
        qc.setQueryData(key, before);
        onError(e);
      });
    },
    [conversationId, qc, onError],
  );
  const close = useCallback(
    (row: Row) => {
      if (!conversationId) return;
      chatClient
        .closePoll(conversationId, row.id)
        .then(
          () => qc.invalidateQueries({ queryKey: chatQueries.messages(conversationId).queryKey }),
          onError,
        );
    },
    [conversationId, qc, onError],
  );
  return { vote, close };
}

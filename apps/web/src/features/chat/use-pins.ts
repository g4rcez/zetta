import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { chatClient, type Pin } from "./chat-client";
import { chatQueries } from "./chat-queries";

const NONE: Pin[] = [];

/**
 * The pinned messages of a conversation and the one call that pins or unpins. The answer of a pin call is the whole list, which
 * replaces the cache at once; the live "conversation changed" signal keeps other people's pins current.
 */
export function usePins(conversationId: string | undefined, onError: (error: unknown) => void) {
  const qc = useQueryClient();
  const { data } = useQuery({
    ...chatQueries.pins(conversationId ?? ""),
    enabled: Boolean(conversationId),
  });
  const pins = data ?? NONE;
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.messageId)), [pins]);
  const setPinned = useCallback(
    (messageId: string, pin: boolean) => {
      if (!conversationId) return;
      void (pin ? chatClient.pin : chatClient.unpin)(conversationId, messageId).then(
        (next) => qc.setQueryData(chatQueries.pins(conversationId).queryKey, next),
        onError,
      );
    },
    [conversationId, qc, onError],
  );
  return { pins, pinnedIds, setPinned };
}

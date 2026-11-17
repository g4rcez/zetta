import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { chatClient, type Message } from "./chat-client";
import { chatQueries } from "./chat-queries";
import type { Row } from "./chat-rows";
import { canEditRow } from "./message-edit";

/** The longest text of a post: a chat takes 32768 characters, a room post 4000. */
export const CHAT_EDIT_MAX = 32_768;

/**
 * Which message of a conversation is being edited, and how it is saved. `submit` is the call of the screen (a chat or a room); the saved
 * message, in the shape of the list, replaces the one in the cache, so the change shows at once and the live signal that follows
 * only confirms it. The editor closes when the server took the text; a refusal throws, and the editor stays open with its text.
 */
export function useEditMessage({
  conversationId,
  submit,
  onSaved,
}: {
  conversationId: string | undefined;
  submit: (messageId: string, text: string) => Promise<Message>;
  /** For a page that keeps messages outside the query cache (the older page a quote jumped to). */
  onSaved?: (message: Message) => void;
}) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string>();
  useEffect(() => setEditingId(undefined), [conversationId]);
  const start = useCallback((row: Row) => {
    if (canEditRow(row)) setEditingId(row.id);
  }, []);
  const cancel = useCallback(() => setEditingId(undefined), []);
  const save = useCallback(
    async (row: Row, text: string) => {
      const edited = await submit(row.id, text);
      if (conversationId)
        qc.setQueryData<Message[]>(chatQueries.messages(conversationId).queryKey, (list) =>
          list?.map((m) => (m.id === edited.id ? { ...m, ...edited } : m)),
        );
      onSaved?.(edited);
      setEditingId(undefined);
    },
    [submit, conversationId, qc, onSaved],
  );
  const revisions = useCallback(
    (row: Row) =>
      conversationId ? chatClient.revisions(conversationId, row.id) : Promise.resolve([]),
    [conversationId],
  );
  return { editingId, start, cancel, save, revisions };
}

import { useCallback, useMemo, useRef } from "react";

import type { Message } from "../chat/chat-client";
import { asRow } from "../chat/chat-rows";
import { lastEditable } from "../chat/message-edit";
import type { RowActions } from "../chat/message-list";
import { useEditMessage } from "../chat/use-edit-message";
import { useQuotedPage } from "../chat/use-quoted-page";
import { discussionsApi } from "./discussions-api";

/** A post in a room holds 4000 characters (a chat message holds more). */
export const ROOM_EDIT_MAX = 4000;

/**
 * What a room's transcript needs beyond the chat's own list: a quote whose original is older than the loaded page loads the page
 * around it, and the owner edits their own posts (the room's endpoint, the room's limit). A person who only reads the room edits nothing.
 * `actions` has stable functions, so the memoized rows do not draw again on every message.
 */
export function useRoomMessages({
  roomId,
  conversationId,
  loaded,
  readOnly,
  onError,
}: {
  roomId: string;
  conversationId: string | undefined;
  loaded: readonly Message[];
  readOnly: boolean;
  onError: (e: unknown) => void;
}) {
  const quoted = useQuotedPage({ conversationId, loaded, onError });
  const edit = useEditMessage({
    conversationId,
    submit: (messageId, text) => discussionsApi.editMessage(roomId, messageId, text),
    onSaved: quoted.replace,
  });
  const latest = useRef({ quoted, edit });
  latest.current = { quoted, edit };
  const actions = useMemo<Partial<RowActions>>(
    () => ({
      onShowMessage: (id) => latest.current.quoted.show(id),
      ...(readOnly
        ? {}
        : {
            onEdit: (row) => latest.current.edit.start(row),
            onSaveEdit: (row, text) => latest.current.edit.save(row, text),
            onCancelEdit: () => latest.current.edit.cancel(),
            loadRevisions: (row) => latest.current.edit.revisions(row),
            editMax: ROOM_EDIT_MAX,
          }),
    }),
    [readOnly],
  );
  const messages = quoted.messages;
  /** The Up arrow of an empty message box: edit the owner's last post. */
  const editLast = useCallback(() => {
    if (readOnly) return;
    const last = lastEditable(messages.map(asRow));
    if (last) latest.current.edit.start(last);
  }, [messages, readOnly]);
  return { messages, actions, editingId: edit.editingId, editLast };
}

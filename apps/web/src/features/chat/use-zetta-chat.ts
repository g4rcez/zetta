import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef } from "react";

import { ENV } from "../../env";
import { cancelTurn } from "./chat-client";
import { liveRows, summaryOf, type ZettaUIMessage } from "./chat-rows";

type Extras = { parentMessageId?: string; attachmentIds?: string[]; fileRefs?: string[] };
const url = (path: string) => new URL(path, ENV.VITE_SERVER_URL).toString();

/**
 * One AI SDK chat bound to a conversation (or a thread inside it). useChat only holds the turn in flight:
 * saved history lives with the caller, which reloads it in `onSettled` and then we drop the transient messages.
 * The conversation id is read through a ref so a first message can create the conversation without remounting the chat mid-stream.
 */
export function useZettaChat({ conversationId, parentMessageId, onSettled, onProposal }: { conversationId?: string; parentMessageId?: string; onSettled: (conversationId: string) => Promise<void> | void; onProposal?: () => void }) {
  const conv = useRef(conversationId);
  conv.current = conversationId;
  const handlers = useRef({ onSettled, onProposal });
  handlers.current = { onSettled, onProposal };
  const origin = useRef<"send" | "resume" | undefined>(undefined); // only surface errors from turns the person started (a missing resume is not an error)

  const transport = useMemo(() => new DefaultChatTransport<ZettaUIMessage>({
    credentials: "include",
    prepareSendMessagesRequest: ({ messages, body }) => {
      const last = messages[messages.length - 1]!, extras = (body ?? {}) as Extras & { conversationId?: string };
      const id = extras.conversationId ?? conv.current;
      const content = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
      return { api: url(`/api/conversations/${id}/chat`), body: { clientRequestId: last.id, content, ...(extras.parentMessageId ? { parentMessageId: extras.parentMessageId } : {}), ...(extras.attachmentIds?.length ? { attachmentIds: extras.attachmentIds } : {}), ...(extras.fileRefs?.length ? { fileRefs: extras.fileRefs } : {}) } };
    },
    prepareReconnectToStreamRequest: () => ({ api: url(`/api/conversations/${conv.current}/chat/stream`) }),
  }), []);

  const chat = useChat<ZettaUIMessage>({
    transport,
    onData: (part) => { if (part.type === "data-proposal") handlers.current.onProposal?.(); },
    onFinish: async ({ isAbort }) => {
      const id = conv.current;
      if (id) await handlers.current.onSettled(id);
      if (!isAbort) chat.setMessages([]);
    },
  });

  // Switching conversations drops the other conversation's turn and reattaches to one still running on the server.
  const adopted = useRef<string | undefined>(undefined); // a conversation created by our own first message: keep its stream
  useEffect(() => {
    if (conversationId && conversationId === adopted.current) { adopted.current = undefined; return; }
    chat.setMessages([]);
    if (conversationId && !parentMessageId) { origin.current = "resume"; void chat.resumeStream().catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, parentMessageId]);

  const busy = chat.status === "submitted" || chat.status === "streaming";
  return {
    rows: liveRows(chat.messages, parentMessageId),
    summary: summaryOf(chat.messages),
    busy,
    error: origin.current === "send" ? chat.error : undefined,
    clearError: chat.clearError,
    send: (text: string, extras: Extras & { conversationId?: string } = {}) => {
      origin.current = "send";
      if (extras.conversationId && extras.conversationId !== conv.current) { adopted.current = extras.conversationId; conv.current = extras.conversationId; }
      return chat.sendMessage({ text }, { body: { ...extras, ...(parentMessageId ? { parentMessageId } : {}) } });
    },
    stop: async () => { await chat.stop(); if (conv.current) await cancelTurn(conv.current).catch(() => {}); if (conv.current) await handlers.current.onSettled(conv.current); chat.setMessages([]); },
  };
}

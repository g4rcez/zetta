import { useChat } from "@ai-sdk/react";
import { uuidv7 } from "@zetta/core/uuid";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

import { ENV } from "../../env";
import { refreshBotStatus } from "../bots/status";
import { cancelTurn, chatClient } from "./chat-client";
import { liveRows, reuseRows, summaryOf, type Row, type ZettaUIMessage } from "./chat-rows";

type Extras = {
  parentMessageId?: string;
  attachmentIds?: string[];
  fileRefs?: string[];
  wikiIds?: string[];
  skills?: string[];
};
const url = (path: string) => new URL(path, ENV.VITE_SERVER_URL).toString();

/**
 * One AI SDK chat bound to a conversation (or a thread inside it). useChat only holds the turn in flight:
 * saved history lives with the caller, which reloads it in `onSettled` and then we drop the transient messages.
 * The conversation id is read through a ref so a first message can create the conversation without remounting the chat mid-stream.
 */
/** Browsers word a cut or refused stream as "network error", "Failed to fetch", "Load failed" or "NetworkError...". */
const isNetworkError = (e: unknown) =>
  e instanceof TypeError ||
  /network|failed to fetch|load failed/i.test(e instanceof Error ? e.message : String(e));

export function useZettaChat({
  conversationId,
  parentMessageId,
  attachKey,
  onSettled,
  onProposal,
  onArtifact,
  onSteer,
}: {
  conversationId?: string;
  parentMessageId?: string;
  /** Changes when another turn starts in the same conversation (group discussions), so the stream reattaches to it. */ attachKey?: string;
  onSettled: (conversationId: string) => Promise<void> | void;
  onProposal?: () => void;
  /** The bot published a file during this turn. */
  onArtifact?: (artifact: { id: string; title: string; at: number }) => void;
  /** The bot took messages sent while it worked: they are no longer queued. */
  onSteer?: () => void;
}) {
  const conv = useRef(conversationId);
  conv.current = conversationId;
  const handlers = useRef({ onSettled, onProposal, onArtifact, onSteer });
  handlers.current = { onSettled, onProposal, onArtifact, onSteer };
  const leaving = useRef(false); // a stop() we issued while switching away from a chat: not a user abort, nothing to settle
  const [dropped, setDropped] = useState(false);
  const origin = useRef<"send" | "resume" | undefined>(undefined); // only surface errors from turns the person started (a missing resume is not an error)

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ZettaUIMessage>({
        credentials: "include",
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1]!,
            extras = (body ?? {}) as Extras & { conversationId?: string };
          const id = extras.conversationId ?? conv.current;
          const content = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          return {
            api: url(`/api/conversations/${id}/chat`),
            body: {
              clientRequestId: last.id,
              content,
              ...(extras.parentMessageId ? { parentMessageId: extras.parentMessageId } : {}),
              ...(extras.attachmentIds?.length ? { attachmentIds: extras.attachmentIds } : {}),
              ...(extras.fileRefs?.length ? { fileRefs: extras.fileRefs } : {}),
              ...(extras.wikiIds?.length ? { wikiIds: extras.wikiIds } : {}),
              ...(extras.skills?.length ? { skills: extras.skills } : {}),
            },
          };
        },
        prepareReconnectToStreamRequest: () => ({
          api: url(`/api/conversations/${conv.current}/chat/stream`),
        }),
      }),
    [],
  );

  const chat = useChat<ZettaUIMessage>({
    transport,
    // One render per ~50ms instead of one per SSE chunk.
    throttle: 50,
    // The server keeps running a turn when the connection drops, so reattach and refresh instead of leaving the person with a dead reply.
    onError: (e) => {
      if (!isNetworkError(e)) return;
      setDropped(true);
      const id = conv.current;
      void (async () => {
        try {
          await chat.resumeStream();
        } catch {
          /* the turn may already be finished */
        }
        if (id) await handlers.current.onSettled(id);
      })();
    },
    onData: (part) => {
      if (part.type === "data-proposal") handlers.current.onProposal?.();
      else if (part.type === "data-artifact") handlers.current.onArtifact?.(part.data);
      else if (part.type === "data-steer") handlers.current.onSteer?.();
    },
    onFinish: async ({ isAbort }) => {
      if (leaving.current) {
        leaving.current = false;
        return;
      }
      const id = conv.current;
      if (id) await handlers.current.onSettled(id);
      if (!isAbort) chat.setMessages([]);
    },
  });

  const live = useRef(chat.status); // the cleanup below runs from a stale closure: read the status through a ref
  live.current = chat.status;
  // Switching conversations drops the other conversation's turn and reattaches to one still running on the server.
  const adopted = useRef<string | undefined>(undefined); // a conversation created by our own first message: keep its stream
  useEffect(() => {
    // The resume GET stays open while the server turn runs: close it when leaving, or each visit leaks a connection and, with the
    // browser's per-host limit of 6, every later request (messages, polls) sits pending forever.
    const close = () => {
      if (live.current === "ready" || live.current === "error") return;
      // Our own first message moved the URL to the conversation it created: that stream belongs to this chat, keep it.
      if (adopted.current && adopted.current === conv.current) return;
      leaving.current = true;
      void chat.stop().finally(() => {
        leaving.current = false;
      });
    };
    if (conversationId && conversationId === adopted.current) {
      adopted.current = undefined;
      return close;
    }
    chat.setMessages([]);
    if (conversationId && !parentMessageId) {
      origin.current = "resume";
      void chat.resumeStream().catch(() => {});
    }
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, parentMessageId, attachKey]);

  const busy = chat.status === "submitted" || chat.status === "streaming";
  // The bot's status changes when its answer starts and ends: do not wait for the next poll.
  useEffect(() => {
    void refreshBotStatus();
  }, [busy]);
  // Live rows get one timestamp per turn, and keep their identity while they do not change.
  const turnStart = useRef("");
  if (chat.messages.length === 0) turnStart.current = "";
  else if (!turnStart.current) turnStart.current = new Date().toISOString();
  const previous = useRef<Row[]>([]);
  const rows = useMemo(
    () =>
      (previous.current = reuseRows(
        previous.current,
        liveRows(chat.messages, parentMessageId, turnStart.current || undefined),
      )),
    [chat.messages, parentMessageId],
  );
  const summary = useMemo(() => summaryOf(chat.messages), [chat.messages]);
  return {
    rows,
    summary,
    busy,
    error:
      origin.current === "send" && chat.error
        ? isNetworkError(chat.error)
          ? new Error(
              "The connection to the server dropped while the bot was working. The reply usually still finishes on the server: reconnecting and refreshing. If nothing appears, reload the page.",
            )
          : chat.error
        : undefined,
    dropped,
    clearError: () => {
      setDropped(false);
      chat.clearError();
    },
    send: async (text: string, extras: Extras & { conversationId?: string } = {}) => {
      // A second useChat request would run beside the first one and break its status, stop and finish: the server queues this
      // message instead and answers it in its thread after the current turn.
      const id = extras.conversationId ?? conv.current;
      if (busy && id) {
        await chatClient.enqueue(id, {
          clientRequestId: uuidv7(),
          content: text,
          ...(extras.parentMessageId || parentMessageId
            ? { parentMessageId: extras.parentMessageId ?? parentMessageId }
            : {}),
          ...(extras.attachmentIds?.length ? { attachmentIds: extras.attachmentIds } : {}),
          ...(extras.fileRefs?.length ? { fileRefs: extras.fileRefs } : {}),
          ...(extras.wikiIds?.length ? { wikiIds: extras.wikiIds } : {}),
          ...(extras.skills?.length ? { skills: extras.skills } : {}),
        });
        await handlers.current.onSettled(id);
        return;
      }
      origin.current = "send";
      if (extras.conversationId && extras.conversationId !== conv.current) {
        adopted.current = extras.conversationId;
        conv.current = extras.conversationId;
      }
      return chat.sendMessage(
        { text },
        { body: { ...extras, ...(parentMessageId ? { parentMessageId } : {}) } },
      );
    },
    /** Attach to a turn the server started on its own (a loop step) when nothing is streaming here. */
    reattach: () => {
      if (busy || !conv.current || parentMessageId) return;
      origin.current = "resume";
      void chat.resumeStream().catch(() => {});
    },
    stop: async () => {
      await chat.stop();
      if (conv.current) await cancelTurn(conv.current).catch(() => {});
      if (conv.current) await handlers.current.onSettled(conv.current);
      chat.setMessages([]);
    },
  };
}

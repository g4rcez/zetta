import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert } from "@g4rcez/components/alert";
import { Button } from "@/components/ui";
import { pollEvery } from "@/lib/query-policy";
import { refreshAttention } from "../attention/summary";
import { FeedbackProvider } from "../bot-quality/feedback";
import {
  chatClient,
  errorMessage,
  type Bot,
  type ChatContext,
  type Message,
  type Proposal,
} from "./chat-client";
import { chatQueries } from "./chat-queries";
import { transcriptRows, type Row } from "./chat-rows";
import { Composer } from "./composer";
import { withExample } from "./example-text";
import { MessageList, type RowActions } from "./message-list";
import { ProposalsPanel } from "./proposals-panel";
import { SetupActionsContext, type SetupActions } from "./setup-actions";
import { useAuthorOf } from "./use-author-of";
import { draftKey, useDraft } from "./use-draft";
import { useFollowQueued } from "./use-follow-queued";
import { useReactions } from "./use-reactions";
import { useZettaChat } from "./use-zetta-chat";
import { useVoiceCall } from "../voice/use-voice-call";
import { VoicePanel, type VoiceControl } from "../voice/voice-panel";

const NO_MESSAGES: Message[] = [];
const NO_PROPOSALS: Proposal[] = [];

function EmbeddedEmpty({
  text,
  examples,
  onPick,
}: {
  text: string;
  examples: readonly string[];
  onPick: (example: string) => void;
}) {
  return (
    <div className="mt-auto space-y-3 px-4 pt-6 pb-4">
      <p className="max-w-prose text-sm text-muted-foreground">{text}</p>
      {examples.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Example questions">
          {examples.map((q) => (
            <Button
              key={q}
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => onPick(q)}
            >
              {q}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export type EmbeddedChatProps = {
  /** The conversation to show: it exists already. */
  conversationId: string;
  bot: Bot | undefined;
  bots: Bot[];
  /** What the page tells the server with each message (see `ChatContext`). Absent: nothing is sent. */
  context?: ChatContext | undefined;
  /** Says to the person what `context` is, above the box. */
  contextNote?: ReactNode;
  /** The empty chat: one sentence and examples that fill the box (they are never sent by themselves). */
  emptyText: string;
  examples: readonly string[];
  label: string;
};

/**
 * One conversation inside another page: the message list, the box, the answer streaming in, approval cards, Stop, and messages sent
 * while the bot works (queued, then answered). It keeps to what a side panel needs; threads, quotes, edits, pins and polls stay in the
 * full chat page.
 */
export function EmbeddedChat({
  conversationId,
  bot,
  bots,
  context,
  contextNote,
  emptyText,
  examples,
  label,
}: EmbeddedChatProps) {
  const qc = useQueryClient();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<ReactNode>();
  const [sent, setSent] = useState(0);
  // Counts the clicks on an example: the box takes the focus after each, so the person can type on at once.
  const [boxFocus, setBoxFocus] = useState(0);
  const fail = (e: unknown) => setError(errorMessage(e));
  const draft = useDraft(draftKey(undefined, conversationId));
  const authorOf = useAuthorOf(bots, bot?.id);
  const messagesQuery = useQuery(chatQueries.messages(conversationId));
  const saved = messagesQuery.data ?? NO_MESSAGES;
  const place = useMemo(() => ({ chatId: conversationId }), [conversationId]);
  const proposalsQuery = useQuery({
    ...chatQueries.proposals(bot?.id, place),
    enabled: !!bot,
    refetchInterval: pollEvery(15_000, 15_000, false),
  });
  const proposals = bot ? (proposalsQuery.data ?? NO_PROPOSALS) : NO_PROPOSALS;
  const loadProposals = useCallback(() => qc.invalidateQueries({ queryKey: ["proposals"] }), [qc]);
  const reload = useCallback(
    (id: string) => qc.invalidateQueries({ queryKey: chatQueries.messages(id).queryKey }),
    [qc],
  );
  const settle = useCallback(
    async (id: string) => {
      await reload(id);
      void qc.invalidateQueries({ queryKey: chatQueries.conversations().queryKey });
      void loadProposals();
      void refreshAttention();
    },
    [qc, reload, loadProposals],
  );
  const main = useZettaChat({
    conversationId,
    onSettled: settle,
    onProposal: () => void loadProposals(),
    onSteer: () => void reload(conversationId),
  });
  useFollowQueued(
    conversationId,
    saved.some((m) => m.queue === "pending" || m.queue === "running"),
    main,
    reload,
    messagesQuery.dataUpdatedAt,
  );
  const rows = useMemo(() => transcriptRows(saved, main.rows), [saved, main.rows]);
  // A side panel always holds a plain chat with one bot, so a spoken call may be held here when voice is set up. The server saves
  // what is said as messages; the panel only refreshes the chat.
  const voice = useVoiceCall({
    conversationId,
    kind: "chat",
    botId: bot?.id,
    onActivity: () => void reload(conversationId),
  });
  const voiceIdle = voice.view.phase === "idle" || voice.view.phase === "ended";
  const voiceControl: VoiceControl | undefined =
    voice.call && voice.availability === "on"
      ? {
          call: voiceIdle ? "idle" : "active",
          botName: bot?.name,
          onToggle: () => (voiceIdle ? void voice.call?.start() : voice.call?.end()),
        }
      : undefined;
  const toggleReact = useReactions(conversationId, fail);
  // The handlers below are made once; they read the latest values through these refs.
  const toggleReactRef = useRef(toggleReact);
  toggleReactRef.current = toggleReact;
  const sendRef = useRef(main.send);
  sendRef.current = main.send;
  const contextRef = useRef(context);
  contextRef.current = context;
  const setupActions = useMemo<SetupActions>(
    () => ({
      say: (text) =>
        void sendRef
          .current(text, contextRef.current ? { context: contextRef.current } : {})
          .catch(() => {}),
    }),
    [],
  );
  const actions = useMemo<RowActions>(
    () => ({
      onReact: (row: Row, emoji) => void toggleReactRef.current(row, emoji),
      onReply: () => {},
      onSaveToMemory: (row) =>
        void chatClient.saveToMemory(`From chat: ${row.content.slice(0, 40)}`, row.content).then(
          (r) =>
            setNotice(
              <>
                Saved to your{" "}
                <Link to="/memory/$slug" params={{ slug: r.slug }} className="underline">
                  memory
                </Link>
                .
              </>,
            ),
          fail,
        ),
      onQueue: (row, action) =>
        void (
          action === "remove"
            ? chatClient.removeQueued(conversationId, row.id)
            : chatClient.retryQueued(conversationId, row.id)
        ).then(() => reload(conversationId), fail),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, reload],
  );
  const empty = !messagesQuery.isLoading && rows.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SetupActionsContext.Provider value={setupActions}>
        <FeedbackProvider conversationId={conversationId}>
          <MessageList
            key={conversationId}
            followToken={sent}
            rows={rows}
            bots={bots}
            authorOf={authorOf}
            fallbackBotId={bot?.id}
            threads={false}
            busy={main.busy || messagesQuery.isLoading}
            label={label}
            actions={actions}
            intro={
              empty ? (
                <EmbeddedEmpty
                  text={emptyText}
                  examples={examples}
                  onPick={(example) => {
                    draft.set(withExample(draft.value, example));
                    setBoxFocus((n) => n + 1);
                  }}
                />
              ) : null
            }
          />
        </FeedbackProvider>
      </SetupActionsContext.Provider>
      <div className="w-full shrink-0 space-y-2 px-3 pb-3">
        <ProposalsPanel
          conversationId={conversationId}
          proposals={proposals}
          bots={bots}
          notify={setNotice}
          onResolved={(id) =>
            qc.setQueryData<Proposal[]>(chatQueries.proposals(bot?.id, place).queryKey, (l) =>
              l?.filter((x) => x.id !== id),
            )
          }
          onBotsChanged={() => void qc.invalidateQueries({ queryKey: chatQueries.bots().queryKey })}
        />
        {notice && (
          <Alert theme="info" onClose={() => setNotice(undefined)}>
            {notice}
          </Alert>
        )}
        {(error || main.error) && (
          <Alert
            theme="danger"
            onClose={() => {
              setError(undefined);
              main.clearError();
            }}
          >
            <p className="break-words">{error ?? errorMessage(main.error)}</p>
          </Alert>
        )}
        {contextNote}
        {voice.call && voice.availability === "on" && (
          <VoicePanel call={voice.call} view={voice.view} />
        )}
        <Composer
          memory
          voice={voiceControl}
          skillBots={bot ? [bot.id] : []}
          value={draft.value}
          focusToken={boxFocus}
          onChange={draft.set}
          placeholder={
            main.busy ? "Add to your request…" : bot ? `Message ${bot.name}` : "Message your bot"
          }
          bots={bots}
          busy={main.busy}
          disabled={!bot}
          conversationId={conversationId}
          onStop={() => void main.stop()}
          onError={fail}
          onSubmit={async ({ text, attachmentIds, fileRefs, memoryIds, skills }) => {
            setError(undefined);
            draft.clear();
            setSent((n) => n + 1);
            try {
              await main.send(text, {
                ...(contextRef.current ? { context: contextRef.current } : {}),
                attachmentIds,
                fileRefs,
                memoryIds,
                skills: skills?.map((k) => k.name),
              });
              return true;
            } catch (e) {
              fail(e);
              return false;
            }
          }}
        />
      </div>
    </div>
  );
}

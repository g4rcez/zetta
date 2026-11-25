import { ActionHint } from "@/components/action-hint";
import { useMemo, useState } from "react";
import { XIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui";

import { errorMessage, type Bot } from "./chat-client";
import { isSavedUserEcho, type Row } from "./chat-rows";
import { Composer } from "./composer";
import { MessageList, quoteAuthorOf, type RowActions } from "./message-list";
import { MessageRow, type Author } from "./message-row";
import { draftKey, useDraft } from "./use-draft";
import { useZettaChat } from "./use-zetta-chat";
import { lastEditable } from "./message-edit";
import { quoteChip, quoteFields } from "./quote-selection";

/** Slack thread pane: the parent message, its replies, and a composer that replies inside the thread. */
export function ThreadPanel({
  conversationId,
  parent,
  replies,
  streamed = [],
  bots,
  bot,
  authorOf,
  actions: pageActions,
  editingId,
  onClose,
  onSettled,
  onProposal,
  onError,
}: {
  conversationId: string;
  parent: Row;
  replies: Row[];
  /** This thread's rows in the chat's own stream: the answer to a queued message is followed there. */
  streamed?: Row[];
  bots: Bot[];
  bot?: Bot | undefined;
  authorOf: (row: Row) => Author;
  actions: RowActions;
  /** The message being edited, in the thread or the parent. */
  editingId?: string | undefined;
  onClose: () => void;
  onSettled: (conversationId: string) => Promise<void>;
  onProposal: () => void;
  onError: (e: unknown) => void;
}) {
  const chat = useZettaChat({ conversationId, parentMessageId: parent.id, onSettled, onProposal });
  const draft = useDraft(draftKey(undefined, `${conversationId}:t:${parent.id}`));
  const [sent, setSent] = useState(0);
  // A reply in the thread quotes inside the thread, so the thread keeps its own choice (the page's would fill the main box).
  const [quoting, setQuoting] = useState<Row>();
  const actions = useMemo(() => ({ ...pageActions, onQuote: setQuoting }), [pageActions]);
  const live = [...chat.rows, ...streamed].filter(
    (r) => !replies.some((x) => x.id === r.id) && !isSavedUserEcho(r, replies),
  );
  const all = [...replies, ...live];
  return (
    <section aria-label="Thread" className="flex h-full min-h-0 flex-col bg-background">
      <header className="chat-gutter flex h-12 shrink-0 items-center gap-2 border-b">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold leading-tight">Thread</h2>
          {bot && <p className="truncate text-xs text-muted-foreground"># {bot.name}</p>}
        </div>
        <ActionHint label="Close thread">
          <Button size="icon-sm" variant="ghost" aria-label="Close thread" onClick={onClose}>
            <XIcon />
          </Button>
        </ActionHint>
      </header>
      <MessageList
        followToken={sent}
        rows={all}
        bots={bots}
        authorOf={authorOf}
        fallbackBotId={bot?.id}
        inThread
        busy={chat.busy}
        label="Thread replies"
        actions={actions}
        editingId={editingId}
        intro={
          <>
            <div className="pt-2">
              <MessageRow
                row={parent}
                author={authorOf(parent)}
                quoteAuthor={quoteAuthorOf(parent, authorOf)}
                continued={false}
                inThread
                editing={editingId === parent.id}
                bots={bots}
                {...actions}
              />
            </div>
            <div
              role="separator"
              className="chat-gutter my-2 flex items-center gap-3 text-xs text-muted-foreground"
            >
              <span>
                {all.length} {all.length === 1 ? "reply" : "replies"}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        }
      />
      <div className="chat-gutter shrink-0 space-y-2 pb-5">
        {chat.error && (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage(chat.error)}
          </p>
        )}
        <Composer
          memory
          skillBots={bot ? [bot.id] : []}
          value={draft.value}
          onChange={draft.set}
          placeholder="Reply…"
          bots={bots}
          busy={chat.busy}
          conversationId={conversationId}
          onError={onError}
          autoFocus
          replyTo={
            quoting && quoteChip(quoting, authorOf(quoting).name, () => setQuoting(undefined))
          }
          onEditLast={() => {
            const last = lastEditable(replies);
            if (last) actions.onEdit?.(last);
          }}
          onStop={() => void chat.stop()}
          onSubmit={async ({ text, attachmentIds, fileRefs, memoryIds, skills }) => {
            draft.clear();
            setSent((n) => n + 1);
            const quoted = quoteFields(quoting);
            setQuoting(undefined);
            try {
              await chat.send(text, {
                ...quoted,
                attachmentIds,
                fileRefs,
                memoryIds,
                skills: skills?.map((k) => k.name),
              });
              return true;
            } catch (e) {
              onError(e);
              return false;
            }
          }}
        />
      </div>
    </section>
  );
}

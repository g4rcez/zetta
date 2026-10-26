import { useState } from "react";
import { X } from "lucide-react";

import { Button } from "@zetta/ui/components/button";

import { errorMessage, type Bot } from "./chat-client";
import type { Row } from "./chat-rows";
import { Composer } from "./composer";
import { MessageList, type RowActions } from "./message-list";
import { MessageRow, type Author } from "./message-row";
import { draftKey, useDraft } from "./use-draft";
import { useZettaChat } from "./use-zetta-chat";

/** Slack thread pane: the parent message, its replies, and a composer that replies inside the thread. */
export function ThreadPanel({ conversationId, parent, replies, bots, bot, authorOf, actions, onClose, onSettled, onProposal, onError }: {
  conversationId: string; parent: Row; replies: Row[]; bots: Bot[]; bot?: Bot | undefined; authorOf: (row: Row) => Author; actions: RowActions;
  onClose: () => void; onSettled: (conversationId: string) => Promise<void>; onProposal: () => void; onError: (e: unknown) => void;
}) {
  const chat = useZettaChat({ conversationId, parentMessageId: parent.id, onSettled, onProposal });
  const draft = useDraft(draftKey(undefined, `${conversationId}:t:${parent.id}`));
  const [sent, setSent] = useState(0);
  const live = chat.rows.filter((r) => !replies.some((x) => x.id === r.id));
  const all = [...replies, ...live];
  return (
    <section aria-label="Thread" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="min-w-0 flex-1"><h2 className="text-base font-bold leading-tight">Thread</h2>{bot && <p className="truncate text-xs text-muted-foreground"># {bot.name}</p>}</div>
        <Button size="icon-sm" variant="ghost" aria-label="Close thread" onClick={onClose}><X /></Button>
      </header>
      <MessageList followToken={sent} rows={all} authorOf={authorOf} fallbackBotId={bot?.id} inThread busy={chat.busy} label="Thread replies" actions={actions}
        intro={<>
          <div className="pt-2"><MessageRow row={parent} author={authorOf(parent)} continued={false} inThread {...actions} /></div>
          <div role="separator" className="my-2 flex items-center gap-3 px-4 text-xs text-muted-foreground"><span>{all.length} {all.length === 1 ? "reply" : "replies"}</span><span className="h-px flex-1 bg-border" /></div>
        </>} />
      <div className="shrink-0 space-y-2 px-4 pb-4">
        {chat.error && <p role="alert" className="text-xs text-destructive">{errorMessage(chat.error)}</p>}
        <Composer value={draft.value} onChange={draft.set} placeholder="Reply…" bots={bots} busy={chat.busy} conversationId={conversationId} onError={onError} autoFocus
          onStop={() => void chat.stop()} onSubmit={async ({ text, attachmentIds, fileRefs }) => { draft.clear(); setSent((n) => n + 1); await chat.send(text, { attachmentIds, fileRefs }); return true; }} />
      </div>
    </section>
  );
}

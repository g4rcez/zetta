import { Fragment, useEffect, type ReactNode } from "react";

import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport, useMessageScroller } from "@zetta/ui/components/message-scroller";

import { cn } from "@zetta/ui/lib/utils";

import { groupMessages, type Row } from "./chat-rows";
import { MessageRow, type Author } from "./message-row";

export type RowActions = { onReact: (row: Row, emoji: string) => void; onReply: (row: Row) => void; onSaveInstruction: (row: Row) => void };

/** Sending always brings you back to the newest message, even after reading history. */
function FollowOnSend({ token }: { token: number }) {
  const { scrollToEnd } = useMessageScroller();
  useEffect(() => { if (token) requestAnimationFrame(() => scrollToEnd({ behavior: "smooth" })); }, [token, scrollToEnd]);
  return null;
}

/**
 * The scrolling log (AI Elements Chat pattern): day dividers, grouped rows, and a jump-to-latest button while you read history.
 * Slack behavior: while you are at the bottom, new and streaming messages keep it in view; scrolling up stops following until you return.
 * (No item is a scroll anchor: anchors pin a message near the top and stop following the bottom, which is the ChatGPT pattern.)
 */
export function MessageList({ rows, authorOf, fallbackBotId, inThread = false, busy, label, intro, footer, actions, followToken = 0 }: {
  rows: Row[]; authorOf: (row: Row) => Author; fallbackBotId?: string | undefined; inThread?: boolean; busy: boolean; label: string; intro?: ReactNode; footer?: ReactNode; actions: RowActions; followToken?: number;
}) {
  return (
    <MessageScrollerProvider autoScroll>
      <FollowOnSend token={followToken} />
      <MessageScroller className="flex-1">
        <MessageScrollerViewport role="log" aria-label={label} aria-live="polite" tabIndex={0}>
          <MessageScrollerContent aria-busy={busy} className={cn("gap-0 pb-4", inThread ? "justify-start" : "justify-end")}>
            {intro}
            {groupMessages(rows, fallbackBotId).map(({ row, continued, day }) => (
              <Fragment key={row.id}>
                {day && !inThread && (
                  <div role="separator" aria-label={day} className="relative my-3 flex items-center px-4">
                    <span className="h-px flex-1 bg-border" />
                    <span className="rounded-full border bg-background px-3 py-0.5 text-xs font-semibold shadow-xs">{day}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>)}
                <MessageScrollerItem messageId={row.id} className="[content-visibility:visible]">
                  <MessageRow row={row} author={authorOf(row)} continued={continued} inThread={inThread} {...actions} />
                </MessageScrollerItem>
              </Fragment>))}
            {footer}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="Jump to latest message" className="rounded-full shadow-md" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

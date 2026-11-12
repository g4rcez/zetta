import type { QueueAction } from "./message-row";
import { Fragment, memo, useEffect, useMemo, type ComponentProps, type ReactNode } from "react";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@zetta/ui/components/message-scroller";

import { cn } from "@zetta/ui/lib/utils";

import { BotsContext } from "@/components/bot-identity";

import type { Bot } from "./chat-client";
import { groupMessages, type Row } from "./chat-rows";
import { repoByRow } from "./github-refs";
import { MessageRow, type Author } from "./message-row";
import type { Pin } from "./chat-client";

export type RowActions = {
  onReact: (row: Row, emoji: string) => void;
  onReply: (row: Row) => void;
  /** Reply in the channel: the next message quotes this one. Without it the toolbar has no Reply button (threads, rooms). */
  onQuote?: (row: Row) => void;
  onSaveToMemory: (row: Row) => void;
  /** Pin or unpin the message. Without it the toolbar has no Pin button. */
  onPin?: (row: Row, pin: boolean) => void;
  /** Sets the viewer's whole choice on the message's poll (empty takes the vote back). Without it a poll shows its results only. */
  onVote?: (row: Row, options: string[]) => void;
  /** Closes the message's poll. Only for someone who may; without it the poll has no Close. */
  onClosePoll?: (row: Row) => void;
  onQueue?: (row: Row, action: QueueAction) => void;
  /** Open a published file beside the chat. Without it, an artifact receipt is a plain link to the artifact page. */
  onOpenArtifact?: (id: string) => void;
  /** Where the live output of a command of the running turn streams from. Without it a step is not clickable (rooms, threads). */
  stepOutputUrl?: (stepId: string) => string | undefined;
};

/** Who wrote the message `row` quotes, found the same way as the author of a row. */
export function quoteAuthorOf(row: Row, authorOf: (row: Row) => Author): Author | undefined {
  const q = row.meta?.quote;
  return q ? authorOf({ ...row, role: q.role, botId: q.botId } as Row) : undefined;
}

/** Who wrote the message a pin points at, found the same way as the author of a row. */
export function pinAuthorOf(
  pin: Pick<Pin, "role" | "botId">,
  authorOf: (row: Row) => Author,
): Author {
  return authorOf({ role: pin.role, botId: pin.botId } as Row);
}

/** Sending always brings you back to the newest message, even after reading history. */
function FollowOnSend({ token }: { token: number }) {
  const { scrollToEnd } = useMessageScroller();
  useEffect(() => {
    if (token) requestAnimationFrame(() => scrollToEnd({ behavior: "smooth" }));
  }, [token, scrollToEnd]);
  return null;
}

const DOWN_KEYS = new Set(["ArrowDown", "PageDown", "End", " "]);
/** Same distance the scroller uses to call a log "at the bottom". */
const BOTTOM_EDGE = 8;

/**
 * The scroller stops following the bottom on any wheel, touch or key event, even when the log already sits at the bottom. No scroll
 * event follows there, so nothing starts the following again and new messages arrive out of sight. A gesture that cannot leave the
 * bottom (wheel down, a down key, a touch that ends there) puts the log back in follow mode.
 */
function PinnedViewport({
  onWheel,
  onKeyDown,
  onTouchEnd,
  ...props
}: ComponentProps<typeof MessageScrollerViewport>) {
  const { scrollToEnd } = useMessageScroller();
  const repin = (el: HTMLElement) =>
    requestAnimationFrame(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_EDGE)
        scrollToEnd({ behavior: "auto" });
    });
  return (
    <MessageScrollerViewport
      {...props}
      onWheel={(e) => {
        if (e.deltaY >= 0) repin(e.currentTarget);
        onWheel?.(e);
      }}
      onKeyDown={(e) => {
        if (DOWN_KEYS.has(e.key)) repin(e.currentTarget);
        onKeyDown?.(e);
      }}
      onTouchEnd={(e) => {
        repin(e.currentTarget);
        onTouchEnd?.(e);
      }}
    />
  );
}

/** The newest rows stay fully rendered so following the bottom measures real heights; older ones keep the scroller's `content-visibility: auto`. */
const RENDERED_TAIL = 30;

type LineProps = {
  row: Row;
  author: Author;
  /** Who wrote the message this row quotes. */
  quoteAuthor: Author | undefined;
  continued: boolean;
  repo: string | undefined;
  day: string | undefined;
  inThread: boolean;
  threads: boolean;
  readOnly: boolean;
  recent: boolean;
  pinned: boolean;
  actions: RowActions;
};

/** One row of the log. Memoized: while a reply streams, only the rows whose props changed render. */
const Line = memo(function Line({
  row,
  author,
  quoteAuthor,
  continued,
  repo,
  day,
  inThread,
  threads,
  readOnly,
  recent,
  pinned,
  actions,
}: LineProps) {
  return (
    <Fragment>
      {day && !inThread && (
        <div role="separator" aria-label={day} className="relative my-3 flex items-center px-4">
          <span className="h-px flex-1 bg-border" />
          <span className="label-mono bg-background px-3">{day}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <MessageScrollerItem
        messageId={row.id}
        className={recent ? "[content-visibility:visible]" : undefined}
      >
        {row.role === "system" ? (
          // A loop step the server started (modules/chat/loops.ts): a quiet marker, not a message someone wrote.
          <div role="note" className="my-2 flex justify-center px-4">
            <span className="max-w-full truncate rounded-full border bg-muted/50 px-3 py-0.5 text-xs text-muted-foreground">
              {row.content}
            </span>
          </div>
        ) : (
          <MessageRow
            row={row}
            author={author}
            quoteAuthor={quoteAuthor}
            continued={continued}
            repo={repo}
            inThread={inThread || !threads}
            readOnly={readOnly}
            pinned={pinned}
            {...actions}
          />
        )}
      </MessageScrollerItem>
    </Fragment>
  );
});

/**
 * The scrolling log (AI Elements Chat pattern): day dividers, grouped rows, and a jump-to-latest button while you read history.
 * Slack behavior: while you are at the bottom, new and streaming messages keep it in view; scrolling up stops following until you return.
 * (No item is a scroll anchor: anchors pin a message near the top and stop following the bottom, which is the ChatGPT pattern.)
 */
export function MessageList({
  rows,
  bots,
  authorOf,
  fallbackBotId,
  inThread = false,
  threads = true,
  readOnly = false,
  busy,
  label,
  intro,
  footer,
  actions,
  pinnedIds,
  followToken = 0,
}: {
  rows: Row[];
  /** The bots of this conversation: their names in a message are drawn as tags. */
  bots: Bot[];
  authorOf: (row: Row) => Author;
  fallbackBotId?: string | undefined;
  inThread?: boolean;
  /** false hides "Reply in thread" where replies are not supported (group discussions). */ threads?: boolean;
  /** Rows without reaction, reply or save actions (the setup interview). */ readOnly?: boolean;
  busy: boolean;
  label: string;
  intro?: ReactNode;
  footer?: ReactNode;
  actions: RowActions;
  /** The ids of the pinned messages of this conversation: their rows show it and offer Unpin. */
  pinnedIds?: ReadonlySet<string> | undefined;
  followToken?: number;
}) {
  const grouped = useMemo(() => groupMessages(rows, fallbackBotId), [rows, fallbackBotId]);
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const repos = useMemo(() => repoByRow(rows), [rows]);
  return (
    <BotsContext.Provider value={botsById}>
      <MessageScrollerProvider autoScroll>
        <FollowOnSend token={followToken} />
        <MessageScroller className="flex-1">
          <PinnedViewport role="log" aria-label={label} aria-live="polite" tabIndex={0}>
            <MessageScrollerContent
              aria-busy={busy}
              // DESIGN.md "Sizes": the chat and a thread fill the panel's width.
              className={cn("gap-0 pb-4", inThread ? "justify-start" : "w-full justify-end")}
            >
              {intro}
              {grouped.map(({ row, continued, day }, i) => (
                <Line
                  key={row.id}
                  row={row}
                  author={authorOf(row)}
                  quoteAuthor={quoteAuthorOf(row, authorOf)}
                  continued={continued}
                  repo={repos.get(row.id)}
                  day={day}
                  inThread={inThread}
                  threads={threads}
                  readOnly={readOnly}
                  recent={i >= grouped.length - RENDERED_TAIL}
                  pinned={pinnedIds?.has(row.id) ?? false}
                  actions={actions}
                />
              ))}
              {footer}
            </MessageScrollerContent>
          </PinnedViewport>
          <MessageScrollerButton
            aria-label="Jump to latest message"
            className="rounded-full shadow-md"
          />
        </MessageScroller>
      </MessageScrollerProvider>
    </BotsContext.Provider>
  );
}

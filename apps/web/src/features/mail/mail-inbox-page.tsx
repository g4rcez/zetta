import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ChatCircleDotsIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PaperclipIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Skeleton } from "@g4rcez/components";
import { ActionHint } from "@/components/action-hint";
import { BotIdentity } from "@/components/bot-identity";
import { ResizeHandle, toWidth } from "@/components/resize-handle";
import { Button } from "@/components/ui";
import { saveLocal } from "@/lib/local-storage";
import { cn } from "@zetta/ui/lib/utils";
import { botRole } from "@zetta/core/bot-role";
import { chatQueries } from "../chat/chat-queries";
import { relativeTime } from "../shared/relative-time";
import { describeFailure, mailQueries, type ConversationSummary, type Mailbox } from "./mail-api";
import { MailChatPanel } from "./mail-chat-panel";
import { ConversationPane, person } from "./mail-conversation";
import { CHAT, mailLayout } from "./mail-layout";
import { withMailSearch, type MailSearch } from "./mail-search";
import { ConnectLink, NoMailbox, ReadFailure, StateBox } from "./mail-states";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const NO_BOTS: never[] = [];
// The chat column's width is a per-browser layout choice. What fits is decided by `mailLayout` from the width of the page.
const CHAT_WIDTH_KEY = "zetta.mail-chat-width";
const readChatWidth = () => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CHAT_WIDTH_KEY) ?? "null");
    return typeof raw === "number" && Number.isFinite(raw)
      ? toWidth(raw, CHAT.min, CHAT.max)
      : CHAT.fallback;
  } catch {
    return CHAT.fallback;
  }
};

/** The width of the element, followed as it changes. Before a layout exists (and in a test DOM) the window's width stands in. */
function useWidthOf() {
  const [element, ref] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () =>
      setWidth(Math.round(element.getBoundingClientRect().width) || window.innerWidth);
    measure();
    const watch = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    watch?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      watch?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element]);
  return [width, ref] as const;
}

/** Shows the chat: where it does not fit it takes the place of the conversation; where it fits it brings the column back. */
function ChatToggle({
  search,
  setSearch,
  fits,
}: {
  search: MailSearch;
  setSearch: MailInboxProps["setSearch"];
  fits: boolean;
}) {
  const wide = fits;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => setSearch({ panel: wide ? undefined : "focus" })}
      className="shrink-0"
      aria-pressed={wide ? search.panel !== "closed" : search.panel === "focus"}
    >
      <ChatCircleDotsIcon aria-hidden="true" className="size-4" />
      Chat
    </Button>
  );
}

function MailboxStateBadge({ state, kind }: { state: Mailbox["state"]; kind: Mailbox["kind"] }) {
  if (state === "retired" && kind === "provisioned")
    return (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Retired
      </span>
    );
  if (state === "active" || state === "retired") return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        state === "needs_auth" ? "bg-warn/10 text-warn" : "bg-destructive/10 text-destructive",
      )}
    >
      {state === "needs_auth"
        ? kind === "google"
          ? "Needs Google sign-in"
          : kind === "microsoft"
            ? "Needs Microsoft sign-in"
            : "Needs password"
        : "Error"}
    </span>
  );
}

/** The mailboxes as a menu in the list header, for when the page has no room for their column. */
function MailboxMenu({ mailboxes, mailbox }: { mailboxes: Mailbox[]; mailbox: Mailbox }) {
  return (
    // Keyed by the mailbox: picking another one closes the menu.
    <details key={mailbox.id} className="border-b px-4 py-2 text-sm">
      <summary className={cn("cursor-pointer truncate rounded-md py-1", focusRing)}>
        Mailbox: {mailbox.label || mailbox.address}
      </summary>
      <div className="pt-2">
        <MailboxList mailboxes={mailboxes} currentId={mailbox.id} />
      </div>
    </details>
  );
}

/** The person's mailboxes, one view each (never merged). The owner bot is drawn with its identity. */
function MailboxList({ mailboxes, currentId }: { mailboxes: Mailbox[]; currentId: string }) {
  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  return (
    <nav aria-label="Mailboxes" className="flex min-h-0 flex-col gap-1">
      <ul className="space-y-px">
        {mailboxes.map((m) => {
          const owner = m.ownerBotId ? bots.find((b) => b.id === m.ownerBotId) : undefined;
          const current = m.id === currentId;
          return (
            <li key={m.id}>
              <Link
                to="/mail/$mailboxId"
                params={{ mailboxId: m.id }}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                  focusRing,
                  current && "bg-accent",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {m.label || m.address}
                  </span>
                  <MailboxStateBadge state={m.state} kind={m.kind} />
                </span>
                {m.label && (
                  <span className="truncate text-xs text-muted-foreground">{m.address}</span>
                )}
                {owner && <BotIdentity bot={owner} size={16} sub={botRole(owner)} />}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        to="/mail/new"
        className={cn("rounded-md px-2 py-1.5 text-sm text-primary hover:bg-accent", focusRing)}
      >
        Connect another mailbox
      </Link>
    </nav>
  );
}

function ConversationRow({
  mailbox,
  item,
  open,
  search,
}: {
  mailbox: Mailbox;
  item: ConversationSummary;
  open: boolean;
  search: MailSearch;
}) {
  const names = item.participants.slice(0, 3).map(person).join(", ");
  const more = item.participants.length - 3;
  return (
    <li>
      <Link
        to="/mail/$mailboxId"
        params={{ mailboxId: mailbox.id }}
        search={withMailSearch(search, { c: item.id })}
        aria-current={open ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-col gap-0.5 px-4 py-3 text-sm hover:bg-accent",
          focusRing,
          "focus-visible:-outline-offset-2",
          open && "bg-accent",
        )}
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">
            {names || "Unknown sender"}
            {more > 0 && <span className="font-normal text-muted-foreground"> +{more}</span>}
          </span>
          <time
            dateTime={item.lastDate}
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
          >
            {relativeTime(item.lastDate)}
          </time>
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{item.subject || "(no subject)"}</span>
          {item.attachments === "some" && (
            <>
              <PaperclipIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="sr-only">Has attachments</span>
            </>
          )}
          {item.messageCount > 1 && (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 text-xs tabular-nums">
              <span className="sr-only">{item.messageCount} messages</span>
              <span aria-hidden="true">{item.messageCount}</span>
            </span>
          )}
        </span>
        {item.snippet && (
          <span className="truncate text-xs text-muted-foreground">{item.snippet}</span>
        )}
      </Link>
    </li>
  );
}

/** Up and Down move between conversations; Tab still walks them one by one. */
function moveFocus(e: KeyboardEvent<HTMLUListElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  const next = links[at + (e.key === "ArrowDown" ? 1 : -1)];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading the inbox" className="space-y-3 p-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="h-4 w-4/5 rounded" />
        </div>
      ))}
    </div>
  );
}

function SearchBox({
  q,
  onSubmit,
}: {
  q: string | undefined;
  onSubmit: (q: string | undefined) => void;
}) {
  // The address holds the search; what is typed is a draft until it is submitted.
  const [draft, setDraft] = useState(q ?? "");
  useEffect(() => setDraft(q ?? ""), [q]);
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(draft.trim() || undefined);
  }
  return (
    <form role="search" onSubmit={submit} className="flex items-center gap-1 px-4 pb-3">
      <div className="relative min-w-0 flex-1">
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          name="q"
          aria-label="Search this mailbox"
          placeholder="Search this mailbox"
          maxLength={200}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={cn(
            "h-8 w-full rounded-md border border-field bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring/40",
          )}
        />
      </div>
      {q && (
        <ActionHint label="Clear the search">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Clear the search"
            onClick={() => onSubmit(undefined)}
          >
            <XIcon aria-hidden="true" className="size-4" />
          </Button>
        </ActionHint>
      )}
    </form>
  );
}

/** Loads the next page when the end of the list scrolls into view. */
function useNearEnd(onNear: () => void) {
  const end = useRef<HTMLLIElement>(null);
  const call = useRef(onNear);
  call.current = onNear;
  useEffect(() => {
    const el = end.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) call.current();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return end;
}

function EndOfList({
  hasMore,
  loading,
  onMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  const end = useNearEnd(() => {
    if (hasMore && !loading) onMore();
  });
  return (
    <li ref={end} className="p-3">
      {hasMore && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full"
          disabled={loading}
          onClick={onMore}
        >
          {loading ? "Loading…" : "Show older"}
        </Button>
      )}
    </li>
  );
}

function ConversationList({
  mailbox,
  search,
  setSearch,
}: {
  mailbox: Mailbox;
  search: MailSearch;
  setSearch: MailInboxProps["setSearch"];
}) {
  const query = useInfiniteQuery(mailQueries.conversations(mailbox.id, search.q));
  const items = query.data?.pages.flatMap((p) => p.conversations) ?? [];
  let body;
  if (query.isPending) body = <ListSkeleton />;
  else if (query.isError)
    body = (
      <ReadFailure
        failure={describeFailure(query.error)}
        mailboxId={mailbox.id}
        what="the inbox"
        onRetry={() => void query.refetch()}
      />
    );
  else if (items.length === 0 && search.q)
    body = (
      <StateBox
        title="No conversation matches"
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSearch({ q: undefined })}
          >
            Clear the search
          </Button>
        }
      >
        Nothing in this mailbox matches “{search.q}”. Try other words.
      </StateBox>
    );
  else if (items.length === 0)
    body = (
      <StateBox title="The inbox is empty">
        Mail that arrives at {mailbox.address} will show here.
      </StateBox>
    );
  else
    body = (
      <ul aria-label="Conversations" onKeyDown={moveFocus} className="divide-y border-y">
        {items.map((item) => (
          <ConversationRow
            key={item.id}
            mailbox={mailbox}
            item={item}
            open={item.id === search.c}
            search={search}
          />
        ))}
        <EndOfList
          hasMore={Boolean(query.hasNextPage)}
          loading={query.isFetchingNextPage}
          onMore={() => void query.fetchNextPage()}
        />
      </ul>
    );
  return (
    <>
      <SearchBox q={search.q} onSubmit={(q) => setSearch({ q, c: undefined })} />
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </>
  );
}

export type MailInboxProps = {
  mailboxId: string;
  /** The view, as it is in the address. */
  search: MailSearch;
  setSearch: (
    patch: Partial<Record<keyof MailSearch, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
};

/**
 * One mailbox's inbox, read-only: nothing here sends, moves, deletes or marks mail. Wide: mailboxes, conversations, the open
 * conversation and the chat with the bot that owns the mailbox. Narrow: the list, then the conversation, with a way back, and the
 * chat as a view of its own.
 */
export function MailInboxPage({ mailboxId, search, setSearch }: MailInboxProps) {
  const boxes = useQuery(mailQueries.mailboxes());
  const mailbox = boxes.data?.find((m) => m.id === mailboxId);
  // Refreshing is a read like any other.
  const [refreshing, setRefreshing] = useState(false);
  const client = useQueryClient();
  const [width, area] = useWidthOf();
  const [chatWidth, setChatWidth] = useState(readChatWidth);
  if (boxes.isPending) return <ListSkeleton />;
  if (boxes.isError)
    return (
      <ReadFailure
        failure={describeFailure(boxes.error)}
        mailboxId={mailboxId}
        what="your mailboxes"
        onRetry={() => void boxes.refetch()}
      />
    );
  if (boxes.data.length === 0) return <NoMailbox />;
  if (!mailbox)
    return (
      <StateBox title="This mailbox is not here" action={<ConnectLink label="Connect a mailbox" />}>
        It may have been removed. Pick another one from{" "}
        <Link to="/mail" className="text-primary underline">
          your mailboxes
        </Link>
        .
      </StateBox>
    );
  const open = Boolean(search.c);
  const layout = mailLayout({ width, chatOpen: search.panel !== "closed", chatWidth });
  const split = layout.panes === "split";
  // Where the chat does not fit it can take the place of the conversation; where it fits it is a column unless the person closed it.
  const chatView = !layout.chatFits && search.panel === "focus";
  const chatColumn = layout.chatColumn;
  const showList = split || !(open || chatView);
  const showConversation = !chatView && (split || open);
  return (
    <div ref={area} className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      {layout.mailboxes === "column" && (
        <aside
          aria-label="Your mailboxes"
          className="flex w-60 shrink-0 flex-col overflow-y-auto border-r p-2"
        >
          <MailboxList mailboxes={boxes.data} currentId={mailbox.id} />
        </aside>
      )}
      <section
        aria-label="Conversations"
        className={cn(
          "min-h-0 min-w-0 flex-col border-r",
          split ? "w-96 shrink-0" : "w-full",
          showList ? "flex" : "hidden",
        )}
      >
        {layout.mailboxes === "menu" && <MailboxMenu mailboxes={boxes.data} mailbox={mailbox} />}
        <header className="flex items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-medium">{mailbox.label || mailbox.address}</h1>
            {mailbox.label && (
              <p className="truncate text-xs text-muted-foreground">{mailbox.address}</p>
            )}
          </div>
          {!chatColumn && (
            <ChatToggle search={search} setSearch={setSearch} fits={layout.chatFits} />
          )}
          <ActionHint label="Refresh">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void client
                  .invalidateQueries({ queryKey: ["mail", mailboxId] })
                  .finally(() => setRefreshing(false));
              }}
            >
              <ArrowClockwiseIcon aria-hidden="true" className="size-4" />
            </Button>
          </ActionHint>
          <ActionHint label="Mailbox settings">
            <Link
              to="/mail/$mailboxId/settings"
              params={{ mailboxId: mailbox.id }}
              aria-label="Mailbox settings"
              className={cn(
                "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
                focusRing,
              )}
            >
              <GearSixIcon aria-hidden="true" className="size-4" />
            </Link>
          </ActionHint>
        </header>
        <ConversationList mailbox={mailbox} search={search} setSearch={setSearch} />
      </section>
      <section
        aria-label="Conversation"
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col overflow-y-auto",
          showConversation ? "flex" : "hidden",
        )}
      >
        {search.c ? (
          <>
            <Link
              to="/mail/$mailboxId"
              params={{ mailboxId: mailbox.id }}
              search={withMailSearch(search, { c: undefined })}
              className={cn(
                "m-2 inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                focusRing,
                split && "hidden",
              )}
            >
              <ArrowLeftIcon aria-hidden="true" className="size-4" />
              Back to conversations
            </Link>
            {!chatColumn && !split && (
              <div className="px-4 pt-2">
                <ChatToggle search={search} setSearch={setSearch} fits={layout.chatFits} />
              </div>
            )}
            <ConversationPane key={search.c} mailboxId={mailbox.id} conversationId={search.c} />
          </>
        ) : (
          <StateBox title="Pick a conversation">Choose one from the list to read it here.</StateBox>
        )}
      </section>
      {chatView && (
        <section aria-label="Chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MailChatPanel
            mailbox={mailbox}
            conversationId={search.c}
            action={{
              label: "Back to mail",
              icon: "text",
              onClick: () => setSearch({ panel: undefined }),
            }}
          />
        </section>
      )}
      {chatColumn && (
        <aside
          aria-label="Chat"
          style={{ width: layout.chatWidth }}
          className="relative flex min-h-0 shrink-0 flex-col border-l"
        >
          <ResizeHandle
            edge="left"
            label="Resize the chat"
            value={layout.chatWidth}
            min={CHAT.min}
            max={layout.chatMax}
            fallback={Math.min(CHAT.fallback, layout.chatMax)}
            onChange={(width) => {
              setChatWidth(width);
              saveLocal(CHAT_WIDTH_KEY, width);
            }}
          />
          <MailChatPanel
            mailbox={mailbox}
            conversationId={search.c}
            action={{
              label: "Close the chat",
              icon: "close",
              onClick: () => setSearch({ panel: "closed" }),
            }}
          />
        </aside>
      )}
    </div>
  );
}

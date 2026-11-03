import { Link } from "@tanstack/react-router";
import { memo, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowBendUpLeftIcon,
  BookmarkSimpleIcon,
  CaretRightIcon,
  CalendarPlusIcon,
  FileArchiveIcon,
  BooksIcon,
  ListChecksIcon,
  UsersIcon,
  ChatTextIcon,
  DotsThreeIcon,
  PaperclipIcon,
  SmileyIcon,
} from "@phosphor-icons/react";

import { Avatar, AvatarFallback, AvatarImage } from "@zetta/ui/components/avatar";
import { Button } from "@zetta/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@zetta/ui/components/popover";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@zetta/ui/components/message";
import { Tooltip, TooltipContent, TooltipTrigger } from "@zetta/ui/components/tooltip";
import { cn } from "@zetta/ui/lib/utils";
import { BotAvatar } from "@/components/bot-avatar";

import { chatClient, errorMessage, isImage, type Bot, type UsedKnowledge } from "./chat-client";
import { PictureStrip } from "./attachment-image";
import { CopyButton } from "./chat-copy";
import { EmojiPicker } from "./emoji-picker";
import { computersOf, type Row } from "./chat-rows";
import { elapsed, friendly, isGeneric, useNow, WorkTimeline } from "./work-timeline";
import { VmCard } from "./vm-card";
import { Response } from "./response";
import { splitActionNotes } from "./action-notes";
import { stripToolFences } from "./tool-fences";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime, formatTime, type TimeFormat } from "@/features/preferences/time-format";

export type Author = { name: string; bot?: Bot | undefined; image?: string | null | undefined };

const time = (iso: string, f: TimeFormat) =>
  formatTime(iso, f, { hour: "numeric", minute: "2-digit" });
const fullDate = (iso: string, f: TimeFormat) =>
  formatDateTime(iso, f, { dateStyle: "full", timeStyle: "short" });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function UsedNotes({ row }: { row: Row }) {
  const [data, setData] = useState<UsedKnowledge>();
  const [error, setError] = useState<string>();
  const used = row.meta?.used,
    n =
      (used?.memories?.length ?? 0) +
      Math.max(used?.instructions?.length ?? 0, used?.wiki?.length ?? 0);
  if (n === 0) return null;
  return (
    <details
      className="text-xs text-muted-foreground"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !data)
          chatClient.usedKnowledge(row.id).then(setData, (x) => setError(errorMessage(x)));
      }}
    >
      <summary className="w-fit cursor-pointer select-none hover:text-foreground">
        Used {n} {n === 1 ? "note" : "notes"}
      </summary>
      <div aria-live="polite" className="mt-1 space-y-1 border-l-2 pl-3">
        {!data && !error && <p>Loading…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {data?.memories.length ? (
          <div>
            <p className="font-medium">Notes and profile</p>
            <ul className="list-disc pl-4">
              {data.memories.map((m) => (
                <li key={m.id} className="break-words">
                  {m.content}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {data?.wiki.length ? (
          <div>
            <p className="font-medium">Wiki</p>
            <ul className="list-disc pl-4">
              {data.wiki.map((m) => (
                <li key={m.id} className="break-words">
                  <Link
                    to="/wiki/$slug"
                    params={{ slug: m.slug }}
                    className="hover:text-foreground hover:underline"
                  >
                    {m.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {data && !data.memories.length && !data.wiki.length && <p>Those notes no longer exist.</p>}
      </div>
    </details>
  );
}

/** The company documents an answer used. Each is re-checked against Drive when opened, so a file you lost access to is not listed. */
function Sources({ row }: { row: Row }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof chatClient.sources>>>();
  const [error, setError] = useState<string>();
  const n = row.meta?.used?.docs?.length ?? 0;
  if (n === 0) return null;
  return (
    <details
      className="text-xs text-muted-foreground"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !list)
          chatClient.sources(row.id).then(setList, (x) => setError(errorMessage(x)));
      }}
    >
      <summary className="w-fit cursor-pointer select-none hover:text-foreground">
        {n} {n === 1 ? "source" : "sources"}
      </summary>
      <div aria-live="polite" className="mt-1 space-y-1 border-l-2 pl-3">
        {!list && !error && <p>Checking access…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {list?.length === 0 && <p>You can no longer open these files.</p>}
        <ol className="space-y-1">
          {list?.map((s) => (
            <li key={s.n} className="break-words">
              <span className="font-medium">[{s.n}]</span>{" "}
              {s.link ? (
                <a
                  href={s.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  {s.name}
                </a>
              ) : (
                s.name
              )}
              {s.snippet && <span className="line-clamp-2 block text-xs">{s.snippet}</span>}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger delay={250} render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const QUICK_REACTIONS: { emoji: string; name: string }[] = [
  { emoji: "👍", name: "Like" },
  { emoji: "👎", name: "Dislike" },
  { emoji: "❤️", name: "Love" },
];

/** Opens the full emoji set in a popover and reacts with the pick. */
function ReactionPicker({ onReact }: { onReact: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="Add reaction">
        <PopoverTrigger
          render={<Button size="icon-xs" variant="ghost" aria-label="Add reaction" />}
        >
          <SmileyIcon />
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" initialFocus={search} className="w-auto rounded-lg p-2">
        <EmojiPicker
          searchRef={search}
          onPick={(emoji) => {
            setOpen(false);
            onReact(emoji);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Floating Slack toolbar: quick reactions, the full emoji picker, reply in the channel, reply in thread, copy, more. */
function HoverBar({
  row,
  inThread,
  entry,
  onReact,
  onReply,
  onQuote,
  onSaveToWiki,
}: {
  row: Row;
  inThread: boolean;
  /** "keyboard": the bar replaced the focused tab stop, so focus moves to its first button. */
  entry: "pointer" | "keyboard";
  onReact: (emoji: string) => void;
  onReply: () => void;
  onQuote: (() => void) | undefined;
  onSaveToWiki: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (entry === "keyboard") bar.current?.querySelector("button")?.focus();
  }, [entry]);
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Message actions"
      className="absolute -top-4 right-4 z-10 flex items-center rounded-lg border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 has-aria-expanded:opacity-100 [@media(hover:none)]:hidden"
    >
      {QUICK_REACTIONS.map(({ emoji, name }) => (
        <Tip key={emoji} label={name}>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`React with ${name}`}
            onClick={() => onReact(emoji)}
          >
            <span className="text-sm leading-none">{emoji}</span>
          </Button>
        </Tip>
      ))}
      <ReactionPicker onReact={onReact} />
      {onQuote && (
        <Tip label="Reply">
          <Button size="icon-xs" variant="ghost" aria-label="Reply" onClick={onQuote}>
            <ArrowBendUpLeftIcon />
          </Button>
        </Tip>
      )}
      {!inThread && (
        <Tip label="Reply in thread">
          <Button size="icon-xs" variant="ghost" aria-label="Reply in thread" onClick={onReply}>
            <ChatTextIcon />
          </Button>
        </Tip>
      )}
      <CopyButton text={row.content} label="Copy message" className="!size-7 [&_svg]:!size-3.5" />
      {row.role === "assistant" && (
        <DropdownMenu>
          <Tip label="More actions">
            <DropdownMenuTrigger
              render={<Button size="icon-xs" variant="ghost" aria-label="More actions" />}
            >
              <DotsThreeIcon />
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onSaveToWiki}>
              <BookmarkSimpleIcon />
              Save to wiki
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Brings the quoted message into view and flashes it. Nothing happens when it is not loaded in this list. */
function showMessage(id: string) {
  const el = document.getElementById(`message-${id}`);
  if (!el) return;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  if (!calm)
    el.animate([{ backgroundColor: "var(--accent)" }, { backgroundColor: "transparent" }], {
      duration: 1200,
      easing: "ease-out",
    });
}

/** The message a channel reply answers: author and the first lines of it. Click goes to the original. */
function QuoteBlock({
  quote,
  author,
}: {
  quote: NonNullable<NonNullable<Row["meta"]>["quote"]>;
  author: Author | undefined;
}) {
  const name = author?.name ?? "Message";
  return (
    <button
      type="button"
      aria-label={`Go to the message from ${name}`}
      onClick={() => showMessage(quote.id)}
      className="flex w-fit max-w-full flex-col items-start gap-0.5 rounded-r-md border-l-2 border-primary/60 py-0.5 pr-2 pl-2 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="font-semibold text-foreground">{name}</span>
      <span className="line-clamp-2 break-words whitespace-pre-line text-muted-foreground">
        {quote.excerpt}
      </span>
    </button>
  );
}

/** Live feedback line for a reply that is not ready yet: the label, plus the time since `since` (when known) and bouncing dots. */
function WorkingStatus({ label, since }: { label: string; since?: string }) {
  const now = useNow(!!since);
  const secs = since ? now - new Date(since).getTime() : undefined;
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-1 text-sm text-muted-foreground"
    >
      {label}
      {secs !== undefined && (
        // Hidden from screen readers: a per-second change would be announced every second.
        <span aria-hidden="true" className="tabular-nums">
          · {elapsed(secs)}
        </span>
      )}
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <i
            key={i}
            className="size-1 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </span>
    </p>
  );
}

/** One Slack-style line: avatar + name + time on the first message of a group, then just the body for follow-ups. */
export const MessageRow = memo(function MessageRow({
  row,
  author,
  quoteAuthor,
  continued,
  repo,
  inThread = false,
  readOnly = false,
  onReact,
  onReply,
  onQuote,
  onSaveToWiki,
  onQueue,
  onOpenArtifact,
}: {
  row: Row;
  author: Author;
  /** Who wrote the message `row.meta.quote` points at. */
  quoteAuthor?: Author | undefined;
  continued: boolean;
  /** `owner/repo` the `#12` and commit ids of this message belong to (see github-refs). */
  repo?: string | undefined;
  inThread?: boolean;
  /** No reactions, replies or saving: for a log that only shows the conversation (the setup interview). */ readOnly?: boolean;
  onReact: (row: Row, emoji: string) => void;
  onReply: (row: Row) => void;
  /** Reply in the channel. Without it the toolbar has no Reply button. */
  onQuote?: (row: Row) => void;
  onSaveToWiki: (row: Row) => void;
  /** A queued message: drop it before it is answered, or put a failed one back in line. */
  onQueue?: (row: Row, action: "remove" | "retry") => void;
  /** Open a published file beside the chat instead of leaving it. */
  onOpenArtifact?: (id: string) => void;
}) {
  const tf = useTimeFormat();
  const saved = !row.streaming && !readOnly;
  // The toolbar (tooltips, popover, menu) mounts on first hover or keyboard focus, not for every row of a long history.
  const [bar, setBar] = useState<"idle" | "pointer" | "keyboard">("idle");
  // A reply is in progress while it streams here or while the saved row is still "running" (page reloaded mid-turn).
  const working = Boolean(row.streaming) || row.status === "running";
  const visible = working ? stripToolFences(row.content).trim() : row.content;
  const { body, notes } =
    row.role === "assistant" && !working
      ? splitActionNotes(row.content)
      : { body: row.content, notes: [] };
  const all = row.meta?.receipts ?? [];
  const receipts = all.filter(
    (r) => r.kind !== "proposal" && r.kind !== "computer" && r.kind !== "bot" && r.kind !== "team",
  );
  const made = all.filter((r) => r.kind === "bot" || r.kind === "team");
  const computers = computersOf(row);
  const replies = row.replyCount ?? 0;
  return (
    <Message
      id={`message-${row.id}`}
      aria-label={`${author.name} at ${time(row.createdAt, tf)}`}
      className={cn(
        "gap-3 px-4 py-0.5 text-sm hover:bg-accent/60 has-aria-expanded:bg-accent/60",
        !continued && "mt-3 pt-1.5",
      )}
      onPointerEnter={
        saved && bar === "idle"
          ? (e) => {
              if (e.pointerType !== "touch") setBar("pointer");
            }
          : undefined
      }
    >
      {saved &&
        (bar === "idle" ? (
          // The one tab stop each row had to reach the toolbar; focusing it swaps in the real toolbar.
          <button
            type="button"
            aria-label="Message actions"
            className="sr-only [@media(hover:none)]:hidden"
            onFocus={() => setBar("keyboard")}
          />
        ) : (
          <HoverBar
            row={row}
            inThread={inThread}
            entry={bar}
            onReact={(e) => onReact(row, e)}
            onReply={() => onReply(row)}
            onQuote={onQuote && (() => onQuote(row))}
            onSaveToWiki={() => onSaveToWiki(row)}
          />
        ))}
      {continued ? (
        <time
          dateTime={row.createdAt}
          title={fullDate(row.createdAt, tf)}
          className="w-8 shrink-0 pt-0.5 text-right text-xs leading-5 text-muted-foreground tabular-nums opacity-0 group-hover/message:opacity-100"
        >
          {time(row.createdAt, tf)}
        </time>
      ) : (
        <MessageAvatar className="mt-0.5 size-8 min-w-8 self-start rounded-lg bg-transparent group-has-data-[slot=message-footer]/message:translate-y-0">
          {author.bot ? (
            <BotAvatar bot={author.bot} size={32} square />
          ) : (
            <Avatar className="size-8 rounded-full after:rounded-full">
              {author.image && <AvatarImage src={author.image} alt="" className="rounded-full" />}
              <AvatarFallback className="rounded-full bg-muted text-xs font-semibold text-foreground">
                {initials(author.name)}
              </AvatarFallback>
            </Avatar>
          )}
        </MessageAvatar>
      )}
      <MessageContent className="gap-1">
        {!continued && (
          <MessageHeader className="gap-2 px-0 text-sm leading-5">
            <span className="truncate font-semibold text-foreground">{author.name}</span>
            {author.bot && <span className="text-xs font-medium text-muted-foreground">App</span>}
            <time
              dateTime={row.createdAt}
              title={fullDate(row.createdAt, tf)}
              className="text-xs font-normal text-muted-foreground tabular-nums hover:underline"
            >
              {time(row.createdAt, tf)}
            </time>
          </MessageHeader>
        )}
        {row.meta?.quote && <QuoteBlock quote={row.meta.quote} author={quoteAuthor} />}
        <PictureStrip pics={(row.attachments ?? []).filter(isImage)} />
        {row.attachments?.some((a) => !isImage(a)) ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Attachments">
            {row.attachments
              .filter((a) => !isImage(a))
              .map((a) => (
                <li
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"
                >
                  <PaperclipIcon aria-hidden="true" className="size-3 text-muted-foreground" />
                  {a.name}
                </li>
              ))}
          </ul>
        ) : null}
        <WorkTimeline row={row} working={working} />
        {working && !visible ? (
          <WorkingStatus
            label={friendly(row.activity) ?? "Thinking"}
            since={isGeneric(row.activity) ? row.createdAt : undefined}
          />
        ) : (
          <>
            <Response text={body} streaming={working} repo={repo} />
            {notes.length > 0 && (
              // DESIGN.md "Bot work": the run's actions fold into one summary line under the reply.
              <details className="group/notes text-xs text-muted-foreground">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <CaretRightIcon
                    aria-hidden="true"
                    className="size-3 transition-transform group-open/notes:rotate-90 motion-reduce:transition-none"
                  />
                  {notes.length} {notes.length === 1 ? "action" : "actions"}
                </summary>
                <ul
                  aria-label="Actions"
                  className="mt-1 list-disc space-y-0.5 pl-5 marker:text-muted-foreground"
                >
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            {working && (
              <WorkingStatus
                label={friendly(row.activity) ?? "Working"}
                since={isGeneric(row.activity) ? row.createdAt : undefined}
              />
            )}
          </>
        )}
        {row.status === "failed" && (
          <p role="alert" className="text-xs font-medium text-destructive">
            This reply failed.
          </p>
        )}
        {row.status === "interrupted" && (
          <p role="alert" className="text-xs font-medium text-destructive">
            Interrupted: the server restarted while answering.
          </p>
        )}
        {row.status === "cancelled" && (
          <p className="text-xs italic text-muted-foreground">Stopped.</p>
        )}
        {row.meta?.steer && (
          <p className="text-xs text-muted-foreground">Used by the bot at its next step.</p>
        )}
        {row.queue === "pending" && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Queued: the bot reads it at its next step, or answers it in its thread after the
              current reply.
            </span>
            {onQueue && !readOnly && (
              <Button size="xs" variant="ghost" onClick={() => onQueue(row, "remove")}>
                Remove
              </Button>
            )}
          </div>
        )}
        {row.queue === "running" && (
          <div className="flex flex-wrap items-center gap-2">
            <WorkingStatus label="Answering in its thread" />
            {!inThread && (
              <Button size="xs" variant="ghost" onClick={() => onReply(row)}>
                View thread
              </Button>
            )}
          </div>
        )}
        {row.queue === "failed" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span role="alert" className="font-medium text-destructive">
              Not answered.
            </span>
            {onQueue && !readOnly && (
              <>
                <Button size="xs" variant="ghost" onClick={() => onQueue(row, "retry")}>
                  Retry
                </Button>
                <Button size="xs" variant="ghost" onClick={() => onQueue(row, "remove")}>
                  Remove
                </Button>
              </>
            )}
          </div>
        )}
        {computers.map((vm) => (
          <VmCard
            key={vm.id}
            vm={vm}
            botName={author.bot?.name}
            working={working}
            steps={row.computerSteps?.filter((x) => x.vmId === vm.id)}
          />
        ))}
        {row.meta?.discussion && (
          <Link
            to="/rooms"
            search={{ id: row.meta.discussion.id }}
            className="w-fit text-xs text-primary hover:underline"
          >
            Open the room “{row.meta.discussion.title}”
          </Link>
        )}
        {made.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Created by the bot">
            {made.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                {r.kind === "bot" ? (
                  <Link
                    to="/chat/{-$chatId}"
                    params={{ chatId: "new" }}
                    search={{ bot: r.id }}
                    className="flex items-center gap-2.5 rounded-lg border bg-card py-2 pr-3 pl-2 text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <BotAvatar bot={{ id: r.id, avatar: r.avatar ?? null }} size={32} square />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{r.text}</span>
                      <span className="block text-muted-foreground">New bot · open chat</span>
                    </span>
                  </Link>
                ) : (
                  <Link
                    to="/teams"
                    className="flex items-center gap-2.5 rounded-lg border bg-card py-2 pr-3 pl-2 text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                      <UsersIcon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{r.text}</span>
                      <span className="block text-muted-foreground">
                        {r.created === false ? "Team updated" : "New team"} · open teams
                      </span>
                    </span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {receipts.length > 0 && (
          <ul
            className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
            aria-label="What the bot saved"
          >
            {receipts.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-center gap-1" title={r.text}>
                {r.kind === "agenda" ? (
                  <Link
                    to="/agenda"
                    search={{ item: r.id }}
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <CalendarPlusIcon aria-hidden="true" className="size-3.5" />
                    {r.created === false ? "updated" : "added"} “{r.text}”
                  </Link>
                ) : r.kind === "task" ? (
                  <Link
                    to="/tasks"
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <ListChecksIcon aria-hidden="true" className="size-3.5" />
                    {r.created === false ? "updated" : "added"} “{r.text}”
                  </Link>
                ) : r.kind === "artifact" ? (
                  <Link
                    to="/artifacts/$artifactId"
                    params={{ artifactId: r.id }}
                    onClick={(e) => {
                      // A plain click opens the side pane; modified clicks (new tab, new window) keep the link.
                      if (
                        !onOpenArtifact ||
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.altKey ||
                        e.button !== 0
                      )
                        return;
                      e.preventDefault();
                      onOpenArtifact(r.id);
                    }}
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <FileArchiveIcon aria-hidden="true" className="size-3.5" />
                    published “{r.text}”
                  </Link>
                ) : r.kind === "wiki" ? (
                  <Link
                    to="/wiki/$slug"
                    params={{ slug: r.id }}
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <BooksIcon aria-hidden="true" className="size-3.5" />
                    {r.created === false ? "updated wiki" : "added to wiki"} “{r.text}”
                  </Link>
                ) : r.kind === "discussion" ? (
                  <Link
                    to="/rooms"
                    search={{ id: r.id }}
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <UsersIcon aria-hidden="true" className="size-3.5" />“{r.text}”
                  </Link>
                ) : (
                  // Receipts of older messages: notes and procedures are wiki items now, so they read the same way.
                  <>
                    <BooksIcon aria-hidden="true" className="size-3.5" />
                    saved to the wiki{r.text ? ` “${r.text}”` : ""}
                    {r.created === false ? " (already saved)" : ""}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {row.role === "assistant" && saved && <UsedNotes row={row} />}
        {row.role === "assistant" && saved && <Sources row={row} />}
        {row.reactions?.some((r) => r.count > 0) && (
          <div role="group" aria-label="Reactions" className="flex flex-wrap items-center gap-1">
            {row.reactions
              .filter((r) => r.count > 0)
              .map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  aria-pressed={r.mine}
                  aria-label={`${r.emoji} ${r.count}${r.mine ? ", including you" : ""}`}
                  onClick={() => onReact(row, r.emoji)}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    r.mine
                      ? "border-primary bg-accent text-foreground"
                      : "bg-muted/50 hover:border-foreground/30",
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="font-medium tabular-nums">{r.count}</span>
                </button>
              ))}
          </div>
        )}
        {!inThread && replies > 0 && (
          <button
            type="button"
            onClick={() => onReply(row)}
            className="group/thread -ml-1 flex w-fit items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-xs hover:border-border hover:bg-card"
          >
            <span className="font-semibold text-primary group-hover/thread:underline">
              {replies} {replies === 1 ? "reply" : "replies"}
            </span>
            <span className="text-muted-foreground">View thread</span>
          </button>
        )}
      </MessageContent>
    </Message>
  );
});

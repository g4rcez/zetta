import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  CalendarPlus,
  FileBox,
  ListChecks,
  Users,
  Brain,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  SmilePlus,
} from "lucide-react";

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
import { VmCard } from "./vm-card";
import { Response } from "./response";
import { splitActionNotes } from "./action-notes";
import { stripToolFences } from "./tool-fences";

export type Author = { name: string; bot?: Bot | undefined; image?: string | null | undefined };

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fullDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
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
    n = (used?.memories?.length ?? 0) + (used?.instructions?.length ?? 0);
  if (n === 0) return null;
  return (
    <details
      className="text-[13px] text-muted-foreground"
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
            <p className="font-medium">Remembered about you</p>
            <ul className="list-disc pl-4">
              {data.memories.map((m) => (
                <li key={m.id} className="break-words">
                  {m.content}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {data?.instructions.length ? (
          <div>
            <p className="font-medium">Instructions</p>
            <ul className="list-disc pl-4">
              {data.instructions.map((m) => (
                <li key={m.id} className="break-words">
                  {m.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {data && !data.memories.length && !data.instructions.length && (
          <p>Those notes no longer exist.</p>
        )}
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
          <SmilePlus />
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

/** Floating Slack toolbar: quick reactions, the full emoji picker, reply in thread, copy, more. */
function HoverBar({
  row,
  inThread,
  onReact,
  onReply,
  onSaveInstruction,
}: {
  row: Row;
  inThread: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onSaveInstruction: () => void;
}) {
  return (
    <div
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
      {!inThread && (
        <Tip label="Reply in thread">
          <Button size="icon-xs" variant="ghost" aria-label="Reply in thread" onClick={onReply}>
            <MessageSquareText />
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
              <MoreHorizontal />
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onSaveInstruction}>
              <BookmarkPlus />
              Save as instruction
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** "plugin postgres.db_overview" -> "Running postgres · db_overview"; other labels pass through. */
const friendly = (activity?: string) => {
  const m = activity?.match(/^(?:plugin|mcp) ([^.\s]+)\.(\S*)$/);
  return m ? `Running ${m[1]}${m[2] ? ` · ${m[2]}` : ""}` : activity;
};

/** Shown while the bot is thinking and no specific step is known, so the wait reads as progress. */
const THINKING = [
  "Thinking",
  "Reading the request",
  "Connecting the dots",
  "Weighing the options",
  "Checking what I know",
  "Putting it together",
  "Double-checking",
  "Almost there",
];
const ROTATE_MS = 2800;

/** A concrete step ("Running postgres · db_overview") is shown as is; with none, a thinking phrase rotates. */
const isGeneric = (activity?: string) => !activity || activity === "Thinking";

/** Live feedback line for a reply that is not ready yet: a label (or rotating thinking phrases) plus bouncing dots. */
function WorkingStatus({ label, rotate = false }: { label: string; rotate?: boolean }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * THINKING.length));
  useEffect(() => {
    if (!rotate) return;
    const t = setInterval(() => setI((n) => (n + 1) % THINKING.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [rotate]);
  return (
    <p
      role="status"
      aria-live={rotate ? "off" : "polite"}
      className="flex items-center gap-1 text-[14px] text-muted-foreground"
    >
      {rotate ? THINKING[i] : label}
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <i
            key={i}
            className="size-1 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </span>
    </p>
  );
}

/** One Slack-style line: avatar + name + time on the first message of a group, then just the body for follow-ups. */
export function MessageRow({
  row,
  author,
  continued,
  inThread = false,
  readOnly = false,
  onReact,
  onReply,
  onSaveInstruction,
}: {
  row: Row;
  author: Author;
  continued: boolean;
  inThread?: boolean;
  /** No reactions, replies or saving: for a log that only shows the conversation (the setup interview). */ readOnly?: boolean;
  onReact: (row: Row, emoji: string) => void;
  onReply: (row: Row) => void;
  onSaveInstruction: (row: Row) => void;
}) {
  const saved = !row.streaming && !readOnly;
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
      aria-label={`${author.name} at ${time(row.createdAt)}`}
      className={cn(
        "gap-3 px-4 py-0.5 text-[15px] hover:bg-foreground/[0.03] has-aria-expanded:bg-foreground/[0.03]",
        !continued && "mt-3 pt-1.5",
      )}
    >
      {saved && (
        <HoverBar
          row={row}
          inThread={inThread}
          onReact={(e) => onReact(row, e)}
          onReply={() => onReply(row)}
          onSaveInstruction={() => onSaveInstruction(row)}
        />
      )}
      {continued ? (
        <time
          dateTime={row.createdAt}
          title={fullDate(row.createdAt)}
          className="w-8 shrink-0 pt-0.5 text-right text-[11px] leading-5 text-muted-foreground opacity-0 group-hover/message:opacity-100"
        >
          {time(row.createdAt)}
        </time>
      ) : (
        <MessageAvatar className="mt-0.5 size-8 min-w-8 self-start rounded-lg bg-transparent group-has-data-[slot=message-footer]/message:translate-y-0">
          {author.bot ? (
            <BotAvatar bot={author.bot} size={32} square />
          ) : (
            <Avatar className="size-8 rounded-lg after:rounded-lg">
              {author.image && <AvatarImage src={author.image} alt="" className="rounded-lg" />}
              <AvatarFallback className="rounded-lg bg-primary/15 text-[13px] font-semibold text-primary">
                {initials(author.name)}
              </AvatarFallback>
            </Avatar>
          )}
        </MessageAvatar>
      )}
      <MessageContent className="gap-1">
        {!continued && (
          <MessageHeader className="gap-2 px-0 text-[14px] leading-5">
            <span className="truncate font-bold text-foreground">{author.name}</span>
            {author.bot && (
              <span className="text-[12px] font-medium text-muted-foreground">App</span>
            )}
            <time
              dateTime={row.createdAt}
              title={fullDate(row.createdAt)}
              className="text-[12px] font-normal text-muted-foreground hover:underline"
            >
              {time(row.createdAt)}
            </time>
          </MessageHeader>
        )}
        <PictureStrip pics={(row.attachments ?? []).filter(isImage)} />
        {row.attachments?.some((a) => !isImage(a)) ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Attachments">
            {row.attachments
              .filter((a) => !isImage(a))
              .map((a) => (
                <li
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-[13px]"
                >
                  <Paperclip aria-hidden="true" className="size-3 text-muted-foreground" />
                  {a.name}
                </li>
              ))}
          </ul>
        ) : null}
        {working && !visible ? (
          <WorkingStatus
            label={friendly(row.activity) ?? "typing"}
            rotate={isGeneric(row.activity)}
          />
        ) : (
          <>
            <Response text={body} streaming={working} />
            {notes.length > 0 && (
              <ul
                aria-label="Actions"
                className="list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground marker:text-muted-foreground/60"
              >
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {working && (
              <WorkingStatus
                label={friendly(row.activity) ?? "Working"}
                rotate={isGeneric(row.activity)}
              />
            )}
          </>
        )}
        {row.status === "failed" && (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            This reply failed.
          </p>
        )}
        {row.status === "interrupted" && (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            Interrupted: the server restarted while answering.
          </p>
        )}
        {row.status === "cancelled" && (
          <p className="text-[13px] italic text-muted-foreground">Stopped.</p>
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
            to="/discussions"
            search={{ id: row.meta.discussion.id }}
            className="w-fit text-[13px] text-primary hover:underline"
          >
            Open the discussion “{row.meta.discussion.title}”
          </Link>
        )}
        {made.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Created by the bot">
            {made.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                {r.kind === "bot" ? (
                  <Link
                    to="/chat/{-$chatId}"
                    search={{ bot: r.id }}
                    className="flex items-center gap-2.5 rounded-lg border bg-card py-2 pr-3 pl-2 text-[13px] hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
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
                    className="flex items-center gap-2.5 rounded-lg border bg-card py-2 pr-3 pl-2 text-[13px] hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                      <Users aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{r.text}</span>
                      <span className="block text-muted-foreground">New team · open teams</span>
                    </span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {receipts.length > 0 && (
          <ul
            className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground"
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
                    <CalendarPlus aria-hidden="true" className="size-3.5" />
                    {r.created === false ? "updated" : "added"} “{r.text}”
                  </Link>
                ) : r.kind === "task" ? (
                  <Link
                    to="/tasks"
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <ListChecks aria-hidden="true" className="size-3.5" />
                    {r.created === false ? "updated" : "added"} “{r.text}”
                  </Link>
                ) : r.kind === "artifact" ? (
                  <Link
                    to="/artifacts/$artifactId"
                    params={{ artifactId: r.id }}
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <FileBox aria-hidden="true" className="size-3.5" />
                    published “{r.text}”
                  </Link>
                ) : r.kind === "discussion" ? (
                  <Link
                    to="/discussions"
                    search={{ id: r.id }}
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <Users aria-hidden="true" className="size-3.5" />“{r.text}”
                  </Link>
                ) : (
                  <>
                    {r.kind === "memory" ? (
                      <Brain aria-hidden="true" className="size-3.5" />
                    ) : (
                      <BookmarkPlus aria-hidden="true" className="size-3.5" />
                    )}
                    {r.kind === "memory" ? "remembered" : "saved instruction"}
                    {r.created === false ? " (already saved)" : ""}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {row.role === "assistant" && saved && <UsedNotes row={row} />}
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
                    "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    r.mine
                      ? "border-primary/60 bg-primary/10 text-primary"
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
            className="group/thread -ml-1 flex w-fit items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-[13px] hover:border-border hover:bg-card"
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
}

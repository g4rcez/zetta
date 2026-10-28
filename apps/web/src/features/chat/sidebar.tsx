import { Link } from "@tanstack/react-router";
import {
  Bell,
  Bot as BotIcon,
  ChevronDown,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Star,
} from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { Button } from "@zetta/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { cn } from "@zetta/ui/lib/utils";
import { Input, Select } from "@/components/ui";
import { BotAvatar } from "@/components/bot-avatar";
import { useAttentionSummary, useBotAttention, type BotAttention } from "../attention/summary";

import type { Bot, Conversation, Workspace } from "./chat-client";

function depthOf(spaces: Workspace[], id: string | null) {
  let d = 0,
    cur = spaces.find((w) => w.id === id);
  while (cur?.parentId && d < 5) {
    d++;
    cur = spaces.find((w) => w.id === cur!.parentId);
  }
  return d;
}

const ORDER_KEY = "zetta.bot-order";
const OPEN_KEY = "zetta.sidebar-open";
// Conversations listed per bot before "Show more"; a search lists every match.
const PER_BOT = 5;
const MODE_KEY = "zetta.sidebar-mode";
type Mode = "bots" | "recent";

/** The user's manual bot order is a per-browser preference: ids in sidebar order, unknown bots fall to the end. */
function readOrder(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The sidebar mode is a per-browser preference. */
function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "recent" ? "recent" : "bots";
  } catch {
    return "bots";
  }
}

/** Calendar-day buckets, newest first, for the Recent mode. */
function bucketByDay(chats: Conversation[]) {
  const day = 86_400_000;
  const today = new Date().setHours(0, 0, 0, 0);
  const label = (iso: string) => {
    const t = new Date(iso).getTime();
    if (t >= today) return "Today";
    if (t >= today - day) return "Yesterday";
    return t >= today - 7 * day ? "Previous 7 days" : "Older";
  };
  const out: { title: string; list: Conversation[] }[] = [];
  for (const c of chats) {
    const title = label(c.updatedAt);
    const last = out[out.length - 1];
    if (last?.title === title) last.list.push(c);
    else out.push({ title, list: [c] });
  }
  return out;
}

/** Which bot sections the user opened (true) or closed (false); a bot with no entry follows the default. */
function readOpen(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

type Props = {
  bots: Bot[];
  spaces: Workspace[];
  chats: Conversation[];
  botId?: string | undefined;
  chatId?: string | undefined;
  onBot: (id: string) => void;
  onChat: (id: string) => void;
  onNewChat: (botId: string) => void;
  onNewBot: () => void;
  onAddSpace: (name: string, parentId?: string) => void;
  onUpdateChat: (
    id: string,
    patch: { title?: string; pinned?: boolean; favorite?: boolean },
  ) => void;
};

const subtitle = (b: Bot) =>
  b.description ||
  (b.kind === "chief"
    ? "Your chief of staff"
    : b.harness === "fixture"
      ? "Offline test bot"
      : `${b.harness}${b.model ? ` · ${b.model}` : ""}`);

/** Short relative time for a row: "now", "5m", "3h", "2d", then a calendar date. */
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** ArrowUp/ArrowDown walk the visible conversation rows, so the list works without the mouse. */
function walkRows(e: KeyboardEvent<HTMLElement>) {
  if (e.altKey || e.metaKey || e.ctrlKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-chat-row]")];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  rows[at + (e.key === "ArrowUp" ? -1 : 1)]?.focus();
}

/** A conversation row. With `bot` it is the two-line form (avatar, title, bot name) for lists that mix bots; without it, the one-line form nested under its bot. The hover menu renames (inline), pins and favorites. */
function ChatRow({
  c,
  bot,
  alert,
  current,
  onOpen,
  onUpdate,
}: {
  c: Conversation;
  bot?: Bot | undefined;
  /** The bot of this row has something waiting for the user. */
  alert?: boolean;
  current: boolean;
  onOpen: (id: string) => void;
  onUpdate: Props["onUpdateChat"];
}) {
  const [editing, setEditing] = useState(false);
  const commit = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (title && title !== c.title) onUpdate(c.id, { title });
  };
  const indent = bot ? "pl-2" : "pl-[3.125rem]";
  if (editing) {
    return (
      <li className={cn("py-0.5 pr-1", indent)}>
        <input
          autoFocus
          aria-label="Rename chat"
          defaultValue={c.title}
          maxLength={120}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              e.currentTarget.value = c.title;
              e.currentTarget.blur();
            }
          }}
          className="h-7 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </li>
    );
  }
  return (
    <li className="group/chat relative">
      <button
        type="button"
        data-chat-row
        aria-current={current}
        title={c.title}
        onClick={() => onOpen(c.id)}
        onDoubleClick={() => setEditing(true)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg pr-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
          bot ? "py-1.5" : "h-8",
          indent,
          current
            ? "bg-sidebar-accent"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        {bot && (
          <span className="relative shrink-0">
            <BotAvatar bot={bot} size={28} />
            {alert && (
              <span
                role="img"
                aria-label="Needs you"
                className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-sidebar bg-destructive"
              />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate", current && "font-medium")}>{c.title}</span>
          {bot && <span className="block truncate text-xs text-muted-foreground">{bot.name}</span>}
        </span>
        {c.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0 opacity-60" />}
        {c.favorite && (
          <Star aria-label="Favorite" className="size-3 shrink-0 fill-amber-400 text-amber-400" />
        )}
        <time
          dateTime={c.updatedAt}
          className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums group-focus-within/chat:opacity-0 group-hover/chat:opacity-0"
        >
          {ago(c.updatedAt)}
        </time>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Actions for ${c.title}`}
              className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/chat:opacity-100 data-popup-open:opacity-100"
            />
          }
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onUpdate(c.id, { pinned: !c.pinned })}>
            {c.pinned ? <PinOff /> : <Pin />}
            {c.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onUpdate(c.id, { favorite: !c.favorite })}>
            <Star />
            {c.favorite ? "Remove from favorites" : "Add to favorites"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

type Reordering = {
  ids: string[];
  dragging: RefObject<boolean>;
  onReorder: (ids: string[]) => void;
};

/**
 * Bots mode: one two-line row per bot (avatar, name, last conversation, time, attention) that unfolds its conversations.
 * Rule: owners see their own unready bots with a setup hint and can still open them to finish setup; nobody else can
 * chat with an unready team bot.
 */
function BotSection({
  bot,
  chats,
  open,
  expanded,
  current,
  attention,
  chatId,
  reordering,
  onToggle,
  onMore,
  onBot,
  onChat,
  onNewChat,
  onUpdateChat,
}: {
  bot: Bot;
  chats: Conversation[];
  open: boolean;
  /** True when every conversation shows, not only the first PER_BOT. */
  expanded: boolean;
  current: boolean;
  attention: BotAttention | undefined;
  chatId: string | undefined;
  reordering?: Reordering | undefined;
  onToggle: () => void;
  onMore: () => void;
  onBot: (id: string) => void;
  onChat: (id: string) => void;
  onNewChat: (id: string) => void;
  onUpdateChat: Props["onUpdateChat"];
}) {
  const controls = useDragControls();
  const blocked = !bot.canEdit && !bot.onboarded;
  const setup = bot.canEdit && !bot.onboarded;
  // The list is newest first, but pinned chats float up, so the latest activity is the max, not the first.
  const latest = chats.reduce<Conversation | undefined>(
    (a, c) => (!a || c.updatedAt > a.updatedAt ? c : a),
    undefined,
  );
  const shown = expanded ? chats : chats.slice(0, PER_BOT);
  const second = blocked
    ? "Not ready · owner is setting it up"
    : setup
      ? "Not ready yet · finish setup"
      : (latest?.title ?? subtitle(bot));
  const tag =
    bot.kind === "chief" ? (
      <span className="sr-only"> (your chief)</span>
    ) : bot.visibility === "private" ? (
      <span className="sr-only"> (private)</span>
    ) : null;
  const header = (
    <div
      className="flex items-center rounded-lg hover:bg-sidebar-accent/60"
      onPointerDown={reordering ? (e) => controls.start(e) : undefined}
      onKeyDown={(e) => {
        // Keyboard alternative to dragging: Alt+Up / Alt+Down moves the focused bot.
        if (!reordering || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        const i = reordering.ids.indexOf(bot.id);
        const j = e.key === "ArrowUp" ? i - 1 : i + 1;
        if (j < 0 || j >= reordering.ids.length) return;
        e.preventDefault();
        const next = [...reordering.ids];
        next.splice(j, 0, ...next.splice(i, 1));
        reordering.onReorder(next);
      }}
    >
      <button
        type="button"
        aria-current={current}
        aria-disabled={blocked || undefined}
        title={
          blocked
            ? "Its owner has to finish setting this bot up before you can chat with it."
            : undefined
        }
        onClick={() => {
          if (reordering?.dragging.current) return;
          if (!blocked) onBot(bot.id);
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pl-2 text-left focus-visible:outline-2 focus-visible:outline-ring",
          blocked && "cursor-not-allowed opacity-50",
        )}
      >
        <BotAvatar bot={bot} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm", current ? "font-semibold" : "font-medium")}>
              {bot.name}
              {tag}
            </span>
            {attention ? (
              // Unread = not seen yet: filled. Seen but still open: outlined.
              <span
                className={cn(
                  "min-w-5 shrink-0 rounded-full px-1.5 text-center text-xs font-medium tabular-nums",
                  attention.unread > 0
                    ? "bg-destructive text-white"
                    : "border border-destructive/60 text-destructive",
                )}
              >
                <span className="sr-only">
                  {attention.unread > 0
                    ? `${attention.unread} unread, ${attention.open} open needing you`
                    : `${attention.open} open needing you`}
                </span>
                <span aria-hidden="true">
                  {attention.unread > 0 ? attention.unread : attention.open}
                </span>
              </span>
            ) : (
              latest &&
              !setup && (
                <time dateTime={latest.updatedAt} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {ago(latest.updatedAt)}
                </time>
              )
            )}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {setup && (
              <span role="img" aria-label="Finish setup" className="size-2 shrink-0 rounded-full bg-amber-400" />
            )}
            <span className="truncate">{second}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} conversations of ${bot.name}`}
        onClick={onToggle}
        className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronDown aria-hidden="true" className={cn("size-4", !open && "-rotate-90")} />
      </button>
    </div>
  );
  const body = open && (
    <ul className="space-y-0.5 pb-1.5">
      <li>
        <button
          type="button"
          disabled={blocked}
          onClick={() => onNewChat(bot.id)}
          className="flex h-8 w-full items-center gap-1.5 rounded-lg pl-[3.125rem] text-left text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          New chat
        </button>
      </li>
      {shown.map((c) => (
        <ChatRow key={c.id} c={c} current={c.id === chatId} onOpen={onChat} onUpdate={onUpdateChat} />
      ))}
      {chats.length > shown.length && (
        <li>
          <button
            type="button"
            onClick={onMore}
            className="h-7 w-full rounded-lg pl-[3.125rem] text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Show {chats.length - shown.length} more
          </button>
        </li>
      )}
    </ul>
  );
  if (!reordering) {
    return (
      <li>
        {header}
        {body}
      </li>
    );
  }
  return (
    <Reorder.Item
      as="li"
      value={bot.id}
      dragListener={false}
      dragControls={controls}
      // "position" only: the default layout animation also scales the box and its text when a section folds or grows.
      layout="position"
      tabIndex={-1}
      whileDrag={{ boxShadow: "0 4px 16px rgb(0 0 0 / 0.35)" }}
      onDragStart={() => {
        reordering.dragging.current = true;
      }}
      onDragEnd={() => {
        // The pointer-up that ends a drag also fires a click on the header; swallow it.
        setTimeout(() => {
          reordering.dragging.current = false;
        }, 0);
      }}
      className="cursor-grab bg-sidebar active:cursor-grabbing"
    >
      {header}
      {body}
    </Reorder.Item>
  );
}

function GroupTitle({ children }: { children: string }) {
  return <h3 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">{children}</h3>;
}

/** Two modes over the same conversations. Bots: the bots come first and the open one unfolds its chats. Recent: every chat by time, each showing its bot. */
export function ChatSidebar({
  bots,
  spaces,
  chats,
  botId,
  chatId,
  onBot,
  onChat,
  onNewChat,
  onNewBot,
  onAddSpace,
  onUpdateChat,
}: Props) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState(readMode);
  const [order, setOrder] = useState(readOrder);
  const [opened, setOpened] = useState(readOpen);
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const dragging = useRef(false);
  const persist = (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch {
      // Storage unavailable (private mode): the preference just lasts for this session.
    }
  };
  useEffect(() => persist(ORDER_KEY, order), [order]);
  useEffect(() => persist(OPEN_KEY, opened), [opened]);
  useEffect(() => persist(MODE_KEY, mode), [mode]);
  const attention = useAttentionSummary();
  const botAttention = useBotAttention();
  const q = query.trim().toLowerCase();
  const chief = bots.find((b) => b.kind === "chief");
  const rank = (b: Bot) => {
    const i = order.indexOf(b.id);
    return i < 0 ? Infinity : i;
  };
  // Array.sort is stable, so bots without a saved position keep the server's order after the ranked ones.
  const rest = bots.filter((b) => b !== chief).sort((a, b) => rank(a) - rank(b));
  const botById = new Map(bots.map((b) => [b.id, b]));
  // A bot whose name matches shows all its chats; otherwise only chats whose title matches.
  const matches = (c: Conversation) =>
    !q ||
    c.title.toLowerCase().includes(q) ||
    !!botById.get(c.botId)?.name.toLowerCase().includes(q);
  const chatsOf = (b: Bot) =>
    chats
      .filter((c) => c.botId === b.id && !c.favorite && matches(c))
      // Pinned first; the server already orders by recency, and Array.sort is stable.
      .sort((a, z) => Number(!!z.pinned) - Number(!!a.pinned));
  const favorites = chats.filter((c) => c.favorite && matches(c));
  // Only the open bot is unfolded by default; while searching every match shows.
  const isOpen = (b: Bot) => !!q || (opened[b.id] ?? b.id === botId);
  const toggle = (b: Bot) => setOpened((o) => ({ ...o, [b.id]: !isOpen(b) }));
  const reorder = (ids: string[]) =>
    setOrder((prev) => [...prev.filter((id) => !ids.includes(id)), ...ids]);
  const section = (b: Bot, ids?: string[]) => {
    const list = chatsOf(b);
    if (q && list.length === 0) return null;
    return (
      <BotSection
        key={b.id}
        bot={b}
        chats={list}
        open={isOpen(b)}
        expanded={!!q || showAll.has(b.id)}
        current={b.id === botId}
        attention={botAttention.get(b.id)}
        chatId={chatId}
        reordering={ids ? { ids, dragging, onReorder: reorder } : undefined}
        onToggle={() => toggle(b)}
        onMore={() => setShowAll((s) => new Set(s).add(b.id))}
        onBot={(id) => {
          setOpened((o) => ({ ...o, [id]: true }));
          onBot(id);
        }}
        onChat={onChat}
        onNewChat={onNewChat}
        onUpdateChat={onUpdateChat}
      />
    );
  };
  const spaceGroups = [
    ...spaces.map((w) => ({ id: w.id as string | null, name: w.name })),
    { id: null, name: "Ungrouped" },
  ];
  // Recent mode: everything by time (pinned and favorites first), the bot shown on each row.
  const everything = chats.filter(matches);
  const top = everything.filter((c) => c.pinned || c.favorite);
  const recent = [
    { title: "Pinned", list: top },
    ...bucketByDay(everything.filter((c) => !c.pinned && !c.favorite)),
  ].filter((g) => g.list.length > 0);
  // One alert dot per bot, on its latest conversation, so a bot with many rows does not light them all.
  const latestOf = new Map<string, string>();
  for (const c of chats) {
    const at = chats.find((x) => x.id === latestOf.get(c.botId));
    if (!at || c.updatedAt > at.updatedAt) latestOf.set(c.botId, c.id);
  }
  const rowOf = (c: Conversation) => (
    <ChatRow
      key={c.id}
      c={c}
      bot={botById.get(c.botId)}
      alert={latestOf.get(c.botId) === c.id && !!botAttention.get(c.botId)?.unread}
      current={c.id === chatId}
      onOpen={onChat}
      onUpdate={onUpdateChat}
    />
  );
  const newChatBot = botId ?? chief?.id;
  const newChatName = (newChatBot && botById.get(newChatBot)?.name) || "bot";
  const empty = q && (mode === "recent" ? recent.length === 0 : !bots.some((b) => chatsOf(b).length > 0) && favorites.length === 0);
  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-sidebar text-sidebar-foreground md:border-r md:border-sidebar-border"
      aria-label="Bots and chats"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-sidebar-border px-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-left text-lg font-bold hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
              />
            }
          >
            <span className="truncate">Chats</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              onClick={() => {
                setAdding(false);
                onNewBot();
              }}
            >
              <BotIcon />
              New bot
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAdding(true)}>
              <FolderPlus />
              New workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="icon-sm"
          variant="ghost"
          title="New bot"
          aria-label="New bot"
          onClick={() => {
            setAdding(false);
            onNewBot();
          }}
        >
          <BotIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="New workspace"
          aria-label="New workspace"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
        >
          <FolderPlus />
        </Button>
        {newChatBot && (
          <Button
            size="icon-sm"
            variant="ghost"
            title={`New chat with ${newChatName}`}
            aria-label={`New chat with ${newChatName}`}
            onClick={() => onNewChat(newChatBot)}
          >
            <Plus />
          </Button>
        )}
      </div>
      <div className="shrink-0 space-y-2 p-2">
        <Input
          title="Filter bots and chats"
          hiddenLabel
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          left={<Search aria-hidden="true" className="size-4 text-muted-foreground" />}
        />
        {adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const name = String(f.get("space") ?? "").trim();
              if (!name) return;
              onAddSpace(name, String(f.get("parent") ?? "") || undefined);
              e.currentTarget.reset();
            }}
            className="flex gap-2 rounded-lg border bg-card p-2"
          >
            <Input title="New workspace" hiddenLabel name="space" placeholder="New workspace" autoFocus />
            {spaces.length > 0 && (
              <Select
                title="Inside workspace"
                hiddenLabel
                container="w-24"
                required={false}
                name="parent"
                options={[
                  { value: "", label: "top" },
                  ...spaces.map((w) => ({ value: w.id, label: w.name })),
                ]}
              />
            )}
            <Button type="submit" size="sm" variant="outline">
              Create
            </Button>
          </form>
        )}
        {attention && attention.unread > 0 && (
          <Link
            to="/studio/$tab"
            params={{ tab: "attention" }}
            className="flex h-8 items-center gap-2 rounded-md px-2.5 text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Bell aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="flex-1">Needs your attention</span>
            <span
              className="rounded-full bg-destructive px-2 text-xs font-medium text-white"
              aria-label={`${attention.unread} unread, ${attention.open} open`}
            >
              {attention.unread}
            </span>
          </Link>
        )}
        <div role="group" aria-label="Sidebar view" className="grid grid-cols-2 gap-0.5 rounded-lg bg-sidebar-accent/50 p-0.5">
          {(["bots", "recent"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-7 rounded-md text-sm font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                mode === m
                  ? "bg-sidebar text-sidebar-foreground shadow-sm"
                  : "text-muted-foreground hover:text-sidebar-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <nav
        aria-label={mode === "bots" ? "Bots" : "Recent conversations"}
        onKeyDown={walkRows}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {mode === "recent" ? (
          recent.map((g) => (
            <section key={g.title}>
              <GroupTitle>{g.title}</GroupTitle>
              <ul className="space-y-0.5">{g.list.map(rowOf)}</ul>
            </section>
          ))
        ) : (
          <>
            {favorites.length > 0 && (
              <section aria-label="Favorites">
                <GroupTitle>Favorites</GroupTitle>
                <ul className="space-y-0.5">{favorites.map(rowOf)}</ul>
              </section>
            )}
            <ul className="space-y-0.5 pt-1">
              {chief && section(chief)}
              {spaceGroups.map((group) => {
                const members = rest.filter((b) => (b.workspaceId ?? null) === group.id);
                if (!members.length) return null;
                const ids = members.map((b) => b.id);
                return (
                  <li key={group.id ?? "none"} role="group" aria-label={group.name}>
                    {spaces.length > 0 && (
                      <h3
                        className="mt-2 mb-1 text-xs text-muted-foreground"
                        style={{ paddingLeft: `${0.5 + depthOf(spaces, group.id) * 0.75}rem` }}
                      >
                        {group.name}
                      </h3>
                    )}
                    {!q && members.length > 1 ? (
                      <Reorder.Group axis="y" as="ul" values={ids} onReorder={reorder} className="space-y-0.5">
                        {members.map((b) => section(b, ids))}
                      </Reorder.Group>
                    ) : (
                      <ul className="space-y-0.5">{members.map((b) => section(b))}</ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {empty && <p className="px-2.5 pt-2 text-xs text-muted-foreground">No chats match.</p>}
        {!q && mode === "recent" && recent.length === 0 && (
          <p className="px-2.5 pt-2 text-xs text-muted-foreground">No conversations yet.</p>
        )}
      </nav>
    </aside>
  );
}

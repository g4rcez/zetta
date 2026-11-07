import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { RoomsSection } from "../discussions/rooms-section";
import { RoutinesSection } from "../routines/routines-section";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  RobotIcon as BotIcon,
  CaretRightIcon,
  ChatCircleIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  FolderPlusIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  TrashIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, Reorder, motion, useDragControls, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { ActionHint } from "@/components/action-hint";
import { cn } from "@zetta/ui/lib/utils";
import { Button, Input, Select } from "@/components/ui";
import { BotAvatar } from "@/components/bot-avatar";
import { BotStatusDot } from "@/components/bot-status";
import { usePreferences } from "../preferences/preferences";
import { useBotAttention, type BotAttention } from "../attention/summary";

import type { Bot, Conversation, Folder } from "./chat-client";
import { ORDER_LIMIT, moveInGroup, orderBots, placeGroup } from "./bot-order";
import { useSidebarData } from "./sidebar-data";
import { relativeTime } from "../shared/relative-time";
import { saveLocal } from "@/lib/local-storage";

export { orderBots };

function depthOf(spaces: Folder[], id: string | null) {
  let d = 0,
    cur = spaces.find((w) => w.id === id);
  while (cur?.parentId && d < 5) {
    d++;
    cur = spaces.find((w) => w.id === cur!.parentId);
  }
  return d;
}

/** Before the order moved to the account it was kept per browser under this key; it is moved over once, then removed. */
const LEGACY_ORDER_KEY = "zetta.bot-order";
const OPEN_KEY = "zetta.sidebar-open";
const BOTS_OPEN_KEY = "zetta.sidebar-bots";
// Conversations listed per bot before "Show more"; a search lists every match.
const PER_BOT = 5;
const MODE_KEY = "zetta.sidebar-mode";
type Mode = "bots" | "recent";

const readJson = <T,>(key: string, fallback: T, valid: (v: unknown) => v is T): T => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return valid(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
};
const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((id) => typeof id === "string");
const isOpenMap = (v: unknown): v is Record<string, boolean> =>
  !!v && typeof v === "object" && !Array.isArray(v);

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

const NO_CHATS: Conversation[] = [];

/** Hover and focus popover with a title and a description. `children` is the element that opens it. */
function Hint({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactElement;
}) {
  return (
    <ActionHint
      delay={0}
      label={
        <span className="flex flex-col items-start gap-0.5">
          <span className="font-medium">{title}</span>
          <span className="opacity-70">{description}</span>
        </span>
      }
    >
      {children}
    </ActionHint>
  );
}

const fullDate = (iso: string) => new Date(iso).toLocaleString();

/** ArrowUp/ArrowDown walk the visible conversation rows, so the list works without the mouse. */
function walkRows(e: KeyboardEvent<HTMLElement>) {
  if (e.altKey || e.metaKey || e.ctrlKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-chat-row]")];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  rows[at + (e.key === "ArrowUp" ? -1 : 1)]?.focus();
}

/** Which bot and chat the URL has open, so every page's sidebar marks the same row. */
export function useSidebarLocation() {
  const { bots, chats } = useSidebarData();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const draftBot = useRouterState({
    select: (s) => (s.location.search as { bot?: string }).bot,
  });
  const open = /^\/chat\/([^/]+)$/.exec(pathname)?.[1];
  const chatId = open && open !== "new" ? open : undefined;
  const onChatPage = pathname === "/chat" || pathname.startsWith("/chat/");
  const botId = chatId
    ? chats.find((c) => c.id === chatId)?.botId
    : onChatPage
      ? (draftBot ?? bots.find((b) => b.kind === "chief")?.id)
      : undefined;
  return { botId, chatId };
}

/** Navigation shared by every sidebar entry point. */
export function useSidebarNavigation() {
  const navigate = useNavigate();
  const { chats } = useSidebarData();
  const toChat = useCallback(
    (chatId: string) => void navigate({ to: "/chat/{-$chatId}", params: { chatId }, search: {} }),
    [navigate],
  );
  const toDraft = useCallback(
    (bot: string) =>
      void navigate({ to: "/chat/{-$chatId}", params: { chatId: "new" }, search: { bot } }),
    [navigate],
  );
  // Picking a bot opens its latest conversation, or an empty draft when it has none.
  const toBot = useCallback(
    (bot: string) => {
      const latest = chats.find((c) => c.botId === bot);
      if (latest) toChat(latest.id);
      else toDraft(bot);
    },
    [chats, toChat, toDraft],
  );
  const toNewBot = useCallback(() => void navigate({ to: "/bots/new" }), [navigate]);
  return { toChat, toDraft, toBot, toNewBot };
}

type UpdateChat = ReturnType<typeof useSidebarData>["updateChat"];
type DeleteChat = (c: Conversation) => void;

/** A conversation row. With `bot` it is the two-line form (avatar, title, bot name) for lists that mix bots; without it, the one-line form nested under its bot. The hover menu renames (inline), pins, favorites and deletes (with Undo). */
function ChatRow({
  c,
  bot,
  alert,
  current,
  onOpen,
  onUpdate,
  onDelete,
}: {
  c: Conversation;
  bot?: Bot | undefined;
  /** The bot of this row has something waiting for the user. */
  alert?: boolean;
  current: boolean;
  onOpen: (id: string) => void;
  onUpdate: UpdateChat;
  onDelete: DeleteChat;
}) {
  const [editing, setEditing] = useState(false);
  const reduce = useReducedMotion();
  const commit = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (title && title !== c.title) onUpdate(c.id, { title });
  };
  const indent = bot ? "pl-2" : "pl-7";
  if (editing) {
    return (
      <li className={cn("py-0.5 pr-1", indent)}>
        <Input
          autoFocus
          size="small"
          title="Rename chat"
          hiddenLabel
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
        />
      </li>
    );
  }
  return (
    <motion.li
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: -8, height: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="group/chat relative"
    >
      <button
        type="button"
        data-chat-row
        aria-current={current ? "page" : undefined}
        title={c.title}
        onClick={() => onOpen(c.id)}
        onDoubleClick={() => setEditing(true)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md pr-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
          bot ? "py-1" : "h-7",
          indent,
          current
            ? "bg-sidebar-accent font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        {bot && (
          <span className="relative shrink-0">
            <BotAvatar bot={bot} size={24} />
            {alert && (
              <span
                role="img"
                aria-label="Needs you"
                className="absolute -top-0.5 -right-0.5 size-2 rounded-full border border-sidebar bg-attention"
              />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{c.title}</span>
          {bot && <span className="block truncate text-xs text-muted-foreground">{bot.name}</span>}
        </span>
        {c.pinned && <PushPinIcon aria-label="Pinned" className="size-3 shrink-0" />}
        {c.favorite && <StarIcon aria-label="Favorite" className="size-3 shrink-0" />}
        {/* Nested rows give the title the whole width; the bot row carries the latest time. */}
        {bot && (
          <Hint title="Last activity" description={fullDate(c.updatedAt)}>
            <time
              dateTime={c.updatedAt}
              className="min-w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums group-focus-within/chat:opacity-0 group-hover/chat:opacity-0"
            >
              {relativeTime(c.updatedAt)}
            </time>
          </Hint>
        )}
      </button>
      <DropdownMenu>
        <Hint title="Chat actions" description="Rename, pin, favorite or delete this chat.">
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`Actions for ${c.title}`}
                className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/chat:opacity-100 data-popup-open:opacity-100"
              />
            }
          >
            <DotsThreeIcon aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilSimpleIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onUpdate(c.id, { pinned: !c.pinned })}>
            {c.pinned ? <PushPinSlashIcon /> : <PushPinIcon />}
            {c.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onUpdate(c.id, { favorite: !c.favorite })}>
            <StarIcon />
            {c.favorite ? "Remove from favorites" : "Add to favorites"}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(c)}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.li>
  );
}

type Reordering = {
  ids: string[];
  dragging: RefObject<boolean>;
  /** Moves this bot one place up (-1) or down (+1) inside its group. */
  onMove: (delta: -1 | 1) => void;
};

/** The attention count of a bot. Unread (not seen yet) is filled amber; seen but still open is a quiet count. */
function AttentionCount({ attention }: { attention: BotAttention }) {
  const unread = attention.unread > 0;
  return (
    <span
      className={cn(
        "min-w-5 shrink-0 rounded-sm px-1.5 text-center text-xs leading-5 font-medium tabular-nums",
        unread ? "bg-attention text-attention-foreground" : "bg-muted text-foreground",
      )}
    >
      <span className="sr-only">
        {unread
          ? `${attention.unread} unread, ${attention.open} open needing you`
          : `${attention.open} open needing you`}
      </span>
      <span aria-hidden="true">{unread ? attention.unread : attention.open}</span>
    </span>
  );
}

/**
 * Bots mode: one 28px row per bot that unfolds its conversations.
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
  onDeleteChat,
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
  onUpdateChat: UpdateChat;
  onDeleteChat: DeleteChat;
}) {
  const controls = useDragControls();
  const reduce = useReducedMotion();
  const listId = useId();
  // The open page is one row: the chat when one is open, the bot only on its empty draft.
  const page = current && !chats.some((c) => c.id === chatId);
  const blocked = !bot.canEdit && !bot.onboarded;
  const setup = bot.canEdit && !bot.onboarded;
  // The list is newest first, but pinned chats float up, so the latest activity is the max, not the first.
  const latest = chats.reduce<Conversation | undefined>(
    (a, c) => (!a || c.updatedAt > a.updatedAt ? c : a),
    undefined,
  );
  const shown = expanded ? chats : chats.slice(0, PER_BOT);
  const at = reordering ? reordering.ids.indexOf(bot.id) : -1;
  const tag =
    bot.kind === "chief" ? (
      <span className="sr-only"> (your chief)</span>
    ) : bot.visibility === "private" ? (
      <span className="sr-only"> (private)</span>
    ) : null;
  const header = (
    <div
      className={cn(
        "flex h-7 items-center rounded-md",
        page ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
      )}
      onPointerDown={reordering ? (e) => controls.start(e) : undefined}
      onKeyDown={(e) => {
        if (!reordering || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        reordering.onMove(e.key === "ArrowUp" ? -1 : 1);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${open ? "Hide" : "Show"} conversations of ${bot.name}`}
        onClick={onToggle}
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <CaretRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </button>
      <button
        type="button"
        data-chat-row
        aria-current={page ? "page" : current ? "true" : undefined}
        aria-disabled={blocked || undefined}
        onKeyDown={(e) => {
          // Tree keys: Right opens the bot's chats, Left closes them.
          if (e.altKey || e.metaKey || e.ctrlKey) return;
          if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) {
            e.preventDefault();
            onToggle();
          }
        }}
        title={
          blocked
            ? "Its owner has to finish setting this bot up before you can chat with it."
            : setup
              ? "Not ready yet: finish setup"
              : undefined
        }
        onClick={() => {
          if (reordering?.dragging.current) return;
          if (!blocked) onBot(bot.id);
        }}
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 pl-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring",
          blocked && "cursor-not-allowed opacity-50",
        )}
      >
        <BotAvatar bot={bot} size={20} badge={<BotStatusDot botId={bot.id} />} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            current || attention?.unread ? "font-semibold" : "font-medium",
          )}
        >
          {bot.name}
          {tag}
        </span>
        {setup && (
          <span
            role="img"
            aria-label="Finish setup"
            className="size-2 shrink-0 rounded-full bg-attention"
          />
        )}
      </button>
      <span className="flex h-7 shrink-0 items-center gap-0.5 pr-1">
        <Hint title="New chat" description={`Start a new conversation with ${bot.name}.`}>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={blocked}
            aria-label={`New chat with ${bot.name}`}
            onClick={() => onNewChat(bot.id)}
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </Hint>
        <DropdownMenu>
          <Hint title="Bot actions" description="Reorder this bot or open its settings.">
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Actions for ${bot.name}`}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-sidebar hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                />
              }
            >
              <DotsThreeIcon aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="start" className="w-48">
            {reordering && (
              <>
                <DropdownMenuItem disabled={at <= 0} onClick={() => reordering.onMove(-1)}>
                  <ArrowUpIcon />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={at < 0 || at >= reordering.ids.length - 1}
                  onClick={() => reordering.onMove(1)}
                >
                  <ArrowDownIcon />
                  Move down
                </DropdownMenuItem>
              </>
            )}
            {bot.canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  render={<Link to="/bots/$botId/settings" params={{ botId: bot.id }} />}
                >
                  <GearSixIcon />
                  Settings
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {attention ? (
          <AttentionCount attention={attention} />
        ) : (
          latest &&
          !setup && (
            <Hint title="Last activity" description={fullDate(latest.updatedAt)}>
              <time
                dateTime={latest.updatedAt}
                className="pl-1 text-xs text-muted-foreground tabular-nums"
              >
                {relativeTime(latest.updatedAt)}
              </time>
            </Hint>
          )
        )}
      </span>
    </div>
  );
  // DESIGN.md "Motion": the chats arrive with a fade and a 4px drop (160ms); with reduced motion they just appear.
  const body = open && (
    <motion.ul
      id={listId}
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="space-y-px pb-1"
    >
      <AnimatePresence initial={false}>
        {shown.map((c) => (
          <ChatRow
            key={c.id}
            c={c}
            current={c.id === chatId}
            onOpen={onChat}
            onUpdate={onUpdateChat}
            onDelete={onDeleteChat}
          />
        ))}
      </AnimatePresence>
      {chats.length > shown.length && (
        <li>
          <button
            type="button"
            onClick={onMore}
            className="h-7 w-full rounded-md pl-7 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Show {chats.length - shown.length} more
          </button>
        </li>
      )}
    </motion.ul>
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
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 600, damping: 40 }}
      tabIndex={-1}
      whileDrag={{ boxShadow: "0 4px 12px rgb(0 0 0 / 0.24)", zIndex: 1 }}
      onDragStart={() => {
        reordering.dragging.current = true;
      }}
      onDragEnd={() => {
        setTimeout(() => {
          reordering.dragging.current = false;
        }, 0);
      }}
      className="cursor-grab rounded-md bg-sidebar active:cursor-grabbing"
    >
      {header}
      {body}
    </Reorder.Item>
  );
}

function GroupTitle({ children }: { children: string }) {
  return <h3 className="label-mono px-2 pt-3 pb-1">{children}</h3>;
}

/**
 * The scrolling part of the app sidebar: a filter, the rooms, and the bots with their chats. Two modes over the same
 * conversations. Bots: the chief first, then the person's order, and each bot unfolds its chats. Recent: every chat by
 * time, each showing its bot. `children` (the More group) scroll after the bots.
 */
export function SidebarTree({ children }: { children?: ReactNode }) {
  const { bots, spaces, chats, chatsLoaded, updateChat, deleteChat, addSpace } = useSidebarData();
  const { botId, chatId } = useSidebarLocation();
  const { toBot, toChat, toDraft, toNewBot } = useSidebarNavigation();
  const navigate = useNavigate();
  // Deleting the open chat moves to the bot's next chat, or to an empty draft.
  const onDeleteChat = (c: Conversation) => {
    if (c.id === chatId) {
      const next = chats.find((x) => x.botId === c.botId && x.id !== c.id);
      if (next) toChat(next.id);
      else toDraft(c.botId);
    }
    deleteChat(c.id);
  };
  const { preferences, set: setPreferences } = usePreferences();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState(readMode);
  const [botsOpen, setBotsOpen] = useState(() =>
    readJson(BOTS_OPEN_KEY, true, (v) => typeof v === "boolean"),
  );
  const [opened, setOpened] = useState(() => readJson(OPEN_KEY, {}, isOpenMap));
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const dragging = useRef(false);
  useEffect(() => saveLocal(OPEN_KEY, opened), [opened]);
  useEffect(() => saveLocal(MODE_KEY, mode), [mode]);
  useEffect(() => saveLocal(BOTS_OPEN_KEY, botsOpen), [botsOpen]);
  const order = preferences.botOrder;
  // The order used to live in this browser only: move it to the account once, unless the account already has one.
  useEffect(() => {
    const legacy = readJson(LEGACY_ORDER_KEY, [], isIdList);
    if (!legacy.length) return;
    if (!order.length) setPreferences({ botOrder: legacy.slice(0, ORDER_LIMIT) });
    try {
      localStorage.removeItem(LEGACY_ORDER_KEY);
    } catch {
      // Storage unavailable: nothing to clean up.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const botAttention = useBotAttention();
  const q = query.trim().toLowerCase();
  const { chief, rest } = orderBots(bots, order);
  const botById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  // A bot whose name matches shows all its chats; otherwise only chats whose title matches.
  const matches = useCallback(
    (c: Conversation) =>
      !q ||
      c.title.toLowerCase().includes(q) ||
      !!botById.get(c.botId)?.name.toLowerCase().includes(q),
    [q, botById],
  );
  // One pass over the chats, not one per bot. Pinned first; the server already orders by recency, and Array.sort is stable.
  const byBot = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of chats) {
      if (c.favorite || !matches(c)) continue;
      const list = map.get(c.botId);
      if (list) list.push(c);
      else map.set(c.botId, [c]);
    }
    for (const list of map.values()) list.sort((a, z) => Number(!!z.pinned) - Number(!!a.pinned));
    return map;
  }, [chats, matches]);
  const chatsOf = (b: Bot) => byBot.get(b.id) ?? NO_CHATS;
  const favorites = useMemo(() => chats.filter((c) => c.favorite && matches(c)), [chats, matches]);
  // Only the open bot is unfolded by default; while searching every match shows.
  const isOpen = (b: Bot) => !!q || (opened[b.id] ?? b.id === botId);
  const toggle = (b: Bot) => setOpened((o) => ({ ...o, [b.id]: !isOpen(b) }));
  const saveGroup = (ids: string[]) => setPreferences({ botOrder: placeGroup(order, ids) });
  const move = (ids: string[], id: string, delta: -1 | 1) => {
    const moved = moveInGroup(ids, id, delta);
    if (!moved) return;
    saveGroup(moved.group);
    setAnnouncement(
      `${botById.get(id)?.name ?? "Bot"} moved to position ${moved.position} of ${ids.length}`,
    );
  };
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
        reordering={ids ? { ids, dragging, onMove: (delta) => move(ids, b.id, delta) } : undefined}
        onToggle={() => toggle(b)}
        onMore={() => setShowAll((s) => new Set(s).add(b.id))}
        onBot={(id) => {
          setOpened((o) => ({ ...o, [id]: true }));
          toBot(id);
        }}
        onChat={toChat}
        onNewChat={toDraft}
        onUpdateChat={updateChat}
        onDeleteChat={onDeleteChat}
      />
    );
  };
  const spaceGroups = [
    ...spaces.map((w) => ({ id: w.id as string | null, name: w.name })),
    { id: null, name: "Ungrouped" },
  ];
  // Recent mode: everything by time (pinned and favorites first), the bot shown on each row.
  const recent = useMemo(() => {
    const everything = chats.filter(matches);
    const top = everything.filter((c) => c.pinned || c.favorite);
    return [
      { title: "Pinned", list: top },
      ...bucketByDay(everything.filter((c) => !c.pinned && !c.favorite)),
    ].filter((g) => g.list.length > 0);
  }, [chats, matches]);
  // One alert dot per bot, on its latest conversation, so a bot with many rows does not light them all.
  const latestOf = useMemo(() => {
    const latest = new Map<string, Conversation>();
    for (const c of chats) {
      const at = latest.get(c.botId);
      if (!at || c.updatedAt > at.updatedAt) latest.set(c.botId, c);
    }
    return latest;
  }, [chats]);
  const rowOf = (c: Conversation) => (
    <ChatRow
      key={c.id}
      c={c}
      bot={botById.get(c.botId)}
      alert={latestOf.get(c.botId)?.id === c.id && !!botAttention.get(c.botId)?.unread}
      current={c.id === chatId}
      onOpen={toChat}
      onUpdate={updateChat}
      onDelete={onDeleteChat}
    />
  );
  const loading = !chatsLoaded && bots.length === 0;
  const empty =
    q &&
    (mode === "recent"
      ? recent.length === 0
      : !bots.some((b) => chatsOf(b).length > 0) && favorites.length === 0);
  const newChatBot = botId ?? chief?.id;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 px-2 pt-2">
        <Input
          type="search"
          size="small"
          title="Filter rooms, bots and chats"
          hiddenLabel
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          left={<MagnifyingGlassIcon aria-hidden="true" className="size-4" />}
        />
        {adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const name = String(f.get("space") ?? "").trim();
              if (!name) return;
              addSpace(name, String(f.get("parent") ?? "") || undefined);
              e.currentTarget.reset();
              setAdding(false);
            }}
            className="flex gap-2 rounded-lg border bg-card p-2"
          >
            <Input title="New folder" hiddenLabel name="space" placeholder="New folder" autoFocus />
            {spaces.length > 0 && (
              <Select
                title="Inside folder"
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
      </div>
      <nav
        onKeyDown={walkRows}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3"
        aria-label="Rooms and bots"
      >
        <RoomsSection query={q} />
        <RoutinesSection query={q} />
        <div className="flex items-center gap-1 pt-3 pb-1 pl-1">
          <button
            type="button"
            aria-expanded={botsOpen || !!q}
            onClick={() => setBotsOpen((o) => !o)}
            className="label-mono flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <CaretRightIcon
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 transition-transform motion-reduce:transition-none",
                (botsOpen || q) && "rotate-90",
              )}
            />
            Bots
          </button>
          <Hint
            title="Recent chats"
            description={
              mode === "recent"
                ? "Showing chats by time. Click to group them by bot."
                : "List every chat by time instead of by bot."
            }
          >
            <button
              type="button"
              aria-pressed={mode === "recent"}
              aria-label="Show chats by time"
              onClick={() => setMode((m) => (m === "recent" ? "bots" : "recent"))}
              className={cn(
                "ml-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                mode === "recent" && "bg-sidebar-accent text-foreground",
              )}
            >
              <ClockCounterClockwiseIcon aria-hidden="true" className="size-4" />
            </button>
          </Hint>
          <DropdownMenu>
            <Hint title="Add" description="Create a chat, bot, folder or room.">
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="Add a chat, bot or folder"
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  />
                }
              >
                <PlusIcon aria-hidden="true" className="size-4" />
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="start" className="w-52">
              {newChatBot && (
                <DropdownMenuItem onClick={() => toDraft(newChatBot)}>
                  <ChatCircleIcon />
                  New chat
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={toNewBot}>
                <BotIcon />
                New bot
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAdding(true)}>
                <FolderPlusIcon />
                New folder
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void navigate({ to: "/rooms", search: { new: true } })}
              >
                New room
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {loading && (
          <ul role="status" aria-label="Loading bots" className="space-y-1">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-7 animate-pulse rounded-md bg-sidebar-accent" />
            ))}
          </ul>
        )}
        {(botsOpen || q) &&
          (mode === "recent" ? (
            recent.map((g) => (
              <section key={g.title}>
                <GroupTitle>{g.title}</GroupTitle>
                <ul className="space-y-px">
                  <AnimatePresence initial={false}>{g.list.map(rowOf)}</AnimatePresence>
                </ul>
              </section>
            ))
          ) : (
            <>
              {favorites.length > 0 && (
                <section aria-label="Favorites">
                  <GroupTitle>Favorites</GroupTitle>
                  <ul className="space-y-px">
                    <AnimatePresence initial={false}>{favorites.map(rowOf)}</AnimatePresence>
                  </ul>
                </section>
              )}
              <ul className="space-y-px">
                {chief && section(chief)}
                {spaceGroups.map((group) => {
                  const members = rest.filter((b) => (b.folderId ?? null) === group.id);
                  if (!members.length) return null;
                  const ids = members.map((b) => b.id);
                  return (
                    <li key={group.id ?? "none"}>
                      <div role="group" aria-label={group.name}>
                        {spaces.length > 0 && (
                          <h3
                            className="mt-2 mb-1 text-xs text-muted-foreground"
                            style={{ paddingLeft: `${0.5 + depthOf(spaces, group.id) * 0.75}rem` }}
                          >
                            {group.name}
                          </h3>
                        )}
                        {!q && members.length > 1 ? (
                          <Reorder.Group
                            axis="y"
                            as="ul"
                            values={ids}
                            onReorder={saveGroup}
                            className="space-y-px"
                          >
                            {members.map((b) => section(b, ids))}
                          </Reorder.Group>
                        ) : (
                          <ul className="space-y-px">{members.map((b) => section(b))}</ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ))}
        {empty && <p className="px-2 pt-2 text-xs text-muted-foreground">No chats match.</p>}
        {!q && mode === "recent" && recent.length === 0 && (
          <p className="px-2 pt-2 text-xs text-muted-foreground">No conversations yet.</p>
        )}
        {children}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </nav>
    </div>
  );
}

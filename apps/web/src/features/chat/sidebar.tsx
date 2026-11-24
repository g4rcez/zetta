import { useNavigate, useRouterState } from "@tanstack/react-router";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { SidebarLayout } from "@/components/sidebar-layout";
import { Input } from "@/components/ui";
import { RoomsSection } from "../discussions/rooms-section";
import { RoutinesSection } from "../routines/routines-section";

import { SidebarBots } from "./sidebar-bots";
import { useSidebarData } from "./sidebar-data";

/** Every row the arrow keys stop on: the conversation rows, and the destination links of a section (`data-walk`). */
const ROWS = "[data-chat-row], [data-walk] a";
/** The rows that count as a match for the filter: the same, without the "All bots" and "All rooms" links. */
const MATCHES = "[data-chat-row]:not([data-extra]), [data-walk] a";

/** ArrowUp/ArrowDown walk the visible rows, Home and End jump to the first and last, so the list works without the mouse. */
function walkRows(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
  if (e.altKey || e.metaKey || e.ctrlKey || !keys.includes(e.key)) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(ROWS)];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const to =
    e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : at + (e.key === "ArrowUp" ? -1 : 1);
  rows[to]?.focus();
}

/** "3 matches" for a screen reader while the filter has text; empty otherwise. It counts the rows on screen, after a short pause so a burst of changes says one thing. */
function useMatchCount(list: RefObject<HTMLElement | null>, query: string, active: boolean) {
  const [text, setText] = useState("");
  useEffect(() => {
    const el = list.current;
    if (!active || !query || !el) {
      setText("");
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const count = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const n = el.querySelectorAll(MATCHES).length;
        setText(n === 0 ? "No matches" : `${n} ${n === 1 ? "match" : "matches"}`);
      }, 200);
    };
    count();
    const watch = new MutationObserver(count);
    watch.observe(el, { childList: true, subtree: true });
    return () => {
      clearTimeout(timer);
      watch.disconnect();
    };
  }, [list, query, active]);
  return text;
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

/**
 * The scrolling part of the app sidebar: a filter, the bots, the rooms and the routines that need a person. Chats are not listed
 * here: a bot opens its latest chat, and the chat header switches between the rest. In the workspace layout `Leading` adds the
 * destination sections (it gets the filter text); in the personal layout `children` (the More group) scroll after the routines.
 */
export function SidebarTree({
  children,
  Leading,
  botLimit,
  botTiles = false,
  layout = "personal",
}: {
  children?: ReactNode;
  /** Shown after the routines: the workspace layout's sections. It receives the lower-case filter text. */
  Leading?: ComponentType<{ query: string }>;
  botLimit?: number;
  /** Bots as avatar tiles (personal layout). */
  botTiles?: boolean;
  layout?: SidebarLayout;
}) {
  const { bots } = useSidebarData();
  const { botId } = useSidebarLocation();
  const { toBot, toDraft, toNewBot } = useSidebarNavigation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const list = useRef<HTMLElement>(null);
  const q = query.trim().toLowerCase();
  const workspace = layout === "workspace";
  const announcement = useMatchCount(list, q, workspace);
  const newChatBot = botId ?? bots.find((b) => b.kind === "chief")?.id;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2">
        <Input
          type="search"
          size="small"
          title={workspace ? "Filter the sidebar" : "Filter rooms and bots"}
          hiddenLabel
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          left={<MagnifyingGlassIcon aria-hidden="true" className="size-4" />}
        />
        {workspace && (
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        )}
      </div>
      <nav
        ref={list}
        onKeyDown={walkRows}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3"
        aria-label={workspace ? "Workspace" : "Rooms and bots"}
      >
        {/* Bots come first: they are who people open the app for. */}
        <SidebarBots
          query={q}
          limit={botLimit}
          tiles={botTiles}
          botId={botId}
          newChatBot={newChatBot}
          onBot={toBot}
          onNewChat={toDraft}
          onNewBot={toNewBot}
          onNewRoom={() => void navigate({ to: "/rooms", search: { new: true } })}
        />
        {/* Rooms sit right under the bots: bots and rooms are the main destinations, the grouped pages follow. */}
        <RoomsSection query={q} layout={layout} />
        <RoutinesSection query={q} layout={layout} />
        {Leading && <Leading query={q} />}
        {children}
      </nav>
    </div>
  );
}

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useCallback, useState, type KeyboardEvent, type ReactNode } from "react";

import { Input } from "@/components/ui";
import { RoomsSection } from "../discussions/rooms-section";
import { RoutinesSection } from "../routines/routines-section";

import { SidebarBots } from "./sidebar-bots";
import { useSidebarData } from "./sidebar-data";

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

/**
 * The scrolling part of the app sidebar: a filter, the rooms, the routines and a short list of bots. Chats are not listed
 * here: a bot opens its latest chat, and the chat header switches between the rest. `children` (the More group) scroll after the bots.
 */
export function SidebarTree({
  children,
  leading,
  botLimit,
}: {
  children?: ReactNode;
  /** Shown above the rooms: the workspace layout's sections. */
  leading?: ReactNode;
  botLimit?: number;
}) {
  const { bots } = useSidebarData();
  const { botId } = useSidebarLocation();
  const { toBot, toDraft, toNewBot } = useSidebarNavigation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const newChatBot = botId ?? bots.find((b) => b.kind === "chief")?.id;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2">
        <Input
          type="search"
          size="small"
          title="Filter rooms and bots"
          hiddenLabel
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          left={<MagnifyingGlassIcon aria-hidden="true" className="size-4" />}
        />
      </div>
      <nav
        onKeyDown={walkRows}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3"
        aria-label="Rooms and bots"
      >
        {leading}
        <RoomsSection query={q} />
        <RoutinesSection query={q} />
        <SidebarBots
          query={q}
          limit={botLimit}
          botId={botId}
          newChatBot={newChatBot}
          onBot={toBot}
          onNewChat={toDraft}
          onNewBot={toNewBot}
          onNewRoom={() => void navigate({ to: "/rooms", search: { new: true } })}
        />
        {children}
      </nav>
    </div>
  );
}

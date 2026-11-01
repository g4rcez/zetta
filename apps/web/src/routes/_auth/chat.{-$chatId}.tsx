import { createFileRoute, redirect } from "@tanstack/react-router";

import { ChatPage } from "@/features/chat/chat-page";

/**
 * The URL is the chat's state: `/chat/<conversationId>` is a conversation (its bot follows from it), `/chat/new?bot=<botId>` is an empty
 * draft for that bot, and a bare `/chat` resolves to the latest conversation. `thread` opens a reply thread inside the conversation, and
 * `artifact` opens a published file in the side pane.
 */
type ChatSearch = {
  thread?: string | undefined;
  bot?: string | undefined;
  c?: string | undefined;
  artifact?: string | undefined;
};

export const Route = createFileRoute("/_auth/chat/{-$chatId}")({
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    ...(typeof search.c === "string" ? { c: search.c } : {}),
    ...(typeof search.thread === "string" ? { thread: search.thread } : {}),
    ...(typeof search.bot === "string" ? { bot: search.bot } : {}),
    ...(typeof search.artifact === "string" && /^[0-9a-f-]{36}$/i.test(search.artifact)
      ? { artifact: search.artifact }
      : {}),
  }),
  // Legacy `/chat?c=<id>` links (stored attention cards, old bookmarks) become the canonical per-chat URL.
  beforeLoad: ({ params, search }) => {
    if (!search.c || params.chatId) return;
    const { c, ...rest } = search;
    throw redirect({ to: "/chat/{-$chatId}", params: { chatId: c }, search: rest, replace: true });
  },
  component: ChatPage,
});

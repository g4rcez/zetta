import { createFileRoute } from "@tanstack/react-router";

import { ChatPage } from "@/features/chat/chat-page";

type ChatSearch = { c?: string | undefined; thread?: string | undefined; bot?: string | undefined };

export const Route = createFileRoute("/_auth/chat")({
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    ...(typeof search.c === "string" ? { c: search.c } : {}),
    ...(typeof search.thread === "string" ? { thread: search.thread } : {}),
    ...(typeof search.bot === "string" ? { bot: search.bot } : {}),
  }),
  component: ChatPage,
});

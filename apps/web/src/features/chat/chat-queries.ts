import { queryOptions } from "@tanstack/react-query";

import { chatClient, loopsOf } from "./chat-client";
import { STATIC } from "@/lib/query-policy";

/**
 * Every chat read has one key, so any two components that show it share one request and one cache entry.
 * Keys nest (`["conversations", id, "messages"]` is under `["conversations"]`): invalidate the prefix after a write.
 */
export const chatQueries = {
  bots: () => queryOptions({ queryKey: ["bots"], queryFn: () => chatClient.bots(), ...STATIC }),
  /** Polled by `useBotStatus`: the dots show what a bot is doing right now. */
  botStatuses: () =>
    queryOptions({ queryKey: ["bots", "status"], queryFn: () => chatClient.botStatuses() }),
  conversations: () =>
    queryOptions({
      queryKey: ["conversations", "list"],
      queryFn: () => chatClient.conversations(),
    }),
  conversation: (id: string) =>
    queryOptions({ queryKey: ["conversations", id], queryFn: () => chatClient.conversation(id) }),
  messages: (conversationId: string) =>
    queryOptions({
      queryKey: ["conversations", conversationId, "messages"],
      queryFn: () => chatClient.messages(conversationId),
    }),
  loops: (conversationId: string) =>
    queryOptions({
      queryKey: ["conversations", conversationId, "loops"],
      queryFn: () => loopsOf(conversationId),
    }),
  folders: () =>
    queryOptions({ queryKey: ["folders"], queryFn: () => chatClient.folders(), ...STATIC }),
  /** With `botId`, only what that bot asked (a chat); without it, every proposal (a room). */
  proposals: (botId?: string) =>
    queryOptions({
      queryKey: ["proposals", { botId: botId ?? null }],
      queryFn: () => chatClient.proposals(botId),
    }),
  /** Chats a bot archived, for the thread tabs. Under `["conversations"]`, so a chat write refreshes it. */
  archived: (botId: string) =>
    queryOptions({
      queryKey: ["conversations", "archived", botId],
      queryFn: () => chatClient.conversations(botId, true),
    }),
  hooks: (botId: string) =>
    queryOptions({ queryKey: ["bots", botId, "hooks"], queryFn: () => chatClient.hooks(botId) }),
  skills: (botId: string) =>
    queryOptions({
      queryKey: ["bots", botId, "skills"],
      queryFn: () => chatClient.botSkills(botId),
    }),
  /** The accounts a bot needs. `version` is in the key because a saved bot can change the list. */
  requirements: (botId: string, version: number) =>
    queryOptions({
      queryKey: ["bots", botId, "requirements", { version }],
      queryFn: () => chatClient.requirements(botId),
    }),
  decisionConfig: (botId: string) =>
    queryOptions({
      queryKey: ["bots", botId, "decision"],
      queryFn: () => chatClient.decisionConfig(botId),
      // The form keeps a draft, so a background refetch has nothing to update.
      refetchOnWindowFocus: false,
    }),
  /** The person's own accounts (Studio, Accounts shows the same list). */
  connections: () =>
    queryOptions({ queryKey: ["connections"], queryFn: () => chatClient.connections(), ...STATIC }),
  /** What a message used: loaded when the person opens the details. */
  usedKnowledge: (messageId: string) =>
    queryOptions({
      queryKey: ["messages", messageId, "knowledge"],
      queryFn: () => chatClient.usedKnowledge(messageId),
    }),
  /** Re-checked against Drive on every open, so a file the person lost access to is not listed. */
  sources: (messageId: string) =>
    queryOptions({
      queryKey: ["messages", messageId, "sources"],
      queryFn: () => chatClient.sources(messageId),
      staleTime: 0,
    }),
};

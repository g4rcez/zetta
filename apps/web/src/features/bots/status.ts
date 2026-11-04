import { useQuery } from "@tanstack/react-query";

import { queryClient } from "@/lib/query-client";
import { pollEvery } from "@/lib/query-policy";
import { ApiError, type BotStatusEntry } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";

/**
 * Every bot status on screen (sidebar, header, mentions) reads one cache entry, so one request serves them all.
 * It polls every 5s while the tab is visible and again as soon as the tab is visible (window focus).
 */
const POLL_MS = 5_000;

/** Asks for fresh statuses now (a turn started or ended). Nothing happens when no component shows a status. */
export const refreshBotStatus = () =>
  queryClient.invalidateQueries({ queryKey: chatQueries.botStatuses().queryKey });

/** The status of one bot, or undefined until the first answer arrives (no dot is shown then). */
export function useBotStatus(botId: string | undefined): BotStatusEntry | undefined {
  return useQuery({
    ...chatQueries.botStatuses(),
    enabled: !!botId,
    // A signed-out answer is final; any other failure keeps the last known status (a stale dot beats a missing one).
    refetchInterval: (q) =>
      q.state.error instanceof ApiError && q.state.error.status === 401
        ? false
        : pollEvery(POLL_MS, POLL_MS, true),
    select: (all) => all.find((s) => s.botId === botId),
  }).data;
}

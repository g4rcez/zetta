import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";

/** What GET /api/bots/:id/activity sends (apps/server/src/modules/bot-quality `activity`). Every series has one value per entry of `days`. */
export type BotActivity = {
  bot: { id: string; name: string };
  timezone: string;
  /** YYYY-MM-DD, oldest first, ending with today in `timezone`. */
  days: string[];
  routines: { active: number; paused: number; runs: number; failed: number };
  calls: { last30: number; allTime: number; toolCalls: number };
  /** Last 30 days, over the calls whose engine reported tokens (only Claude Code does): `reportedCalls` of `calls.last30`. `input` is the part not served from the cache. */
  tokens: {
    input: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
    total: number;
    reportedCalls: number;
  };
  messages: { sent: number; received: number };
  tasks: { open: number; blocked: number; done: number; total: number };
  series: { calls: number[]; messages: number[]; routineRuns: number[] };
};

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const botStatsQueries = {
  activity: (botId: string) =>
    queryOptions({
      queryKey: ["bot-quality", "activity", botId],
      queryFn: async () =>
        (
          await call<{ activity: BotActivity }>(
            `/api/bots/${botId}/activity?tz=${encodeURIComponent(browserZone())}`,
          )
        ).activity,
    }),
};

import { queryOptions } from "@tanstack/react-query";

import { call } from "../chat/chat-client";

/** What the server sends for ratings, numbers, saved tests and version history (apps/server/src/modules/bot-quality). */
export type Rating = "up" | "down";
export type Ratings = Record<string, { rating: Rating; reason: string }>;

export type BotStats = {
  bot: { id: string; name: string; version: number };
  days: 7 | 30;
  runs: { total: number; ok: number; cancelled: number; failed: number };
  duration: { medianMs: number | null; p90Ms: number | null; samples: number };
  stepIn: { cancelledReplies: number; steered: number; approvalCards: number; askedYou: number };
  feedback: { up: number; down: number };
};

export type DriveRun = {
  id: string;
  promptId: string;
  botVersion: number;
  status: "running" | "done" | "failed";
  error: string;
  createdAt: string;
  finishedAt: string | null;
  answer: string | null;
  conversationId: string | null;
};
export type DrivePrompt = { id: string; title: string; prompt: string; runs: DriveRun[] };
export type Drive = {
  bot: { id: string; name: string; version: number };
  limit: number;
  prompts: DrivePrompt[];
};

/** The settings a version holds. Versions saved before 2026-11-15 hold only the first nine. */
export type BotConfigSnapshot = Partial<{
  name: string;
  description: string;
  harness: string;
  model: string | null;
  personality: string;
  instructions: string;
  outputStyle: string;
  outputStyleId: string | null;
  visibility: "private" | "team";
  fallbackHarness: string | null;
  fallbackModel: string | null;
  computerMode: "off" | "browser" | "desktop";
  autoLearn: "off" | "suggest" | "auto";
  codeAccess: boolean;
  commitIdentity: string;
  commitEmail: string | null;
  contextBytes: number | null;
  summaryMode: "chief" | "bot" | "off";
  summaryMaxChars: number | null;
  summaryGapBytes: number | null;
  chatSearchLimit: number | null;
}>;
export type Revision = {
  version: number;
  createdAt: string;
  current: boolean;
  /** The settings that differ from the version before it. */
  changed: string[];
  config: BotConfigSnapshot;
};
export type Revisions = {
  bot: { id: string; name: string; version: number };
  revisions: Revision[];
};

export const qualityApi = {
  rate: (messageId: string, rating: Rating, reason = "") =>
    call<{ feedback: { messageId: string; rating: Rating; reason: string } }>(
      `/api/messages/${messageId}/feedback`,
      "PUT",
      { rating, reason },
    ),
  clearRating: (messageId: string) =>
    call<{ cleared: boolean }>(`/api/messages/${messageId}/feedback`, "DELETE"),
  addPrompt: (botId: string, title: string, prompt: string) =>
    call<{ prompt: { id: string } }>(`/api/bots/${botId}/drive/prompts`, "POST", { title, prompt }),
  updatePrompt: (botId: string, id: string, title: string, prompt: string) =>
    call<{ prompt: { id: string } }>(`/api/bots/${botId}/drive/prompts/${id}`, "PATCH", {
      title,
      prompt,
    }),
  removePrompt: (botId: string, id: string) =>
    call<{ removed: boolean }>(`/api/bots/${botId}/drive/prompts/${id}`, "DELETE"),
  run: (botId: string, promptId?: string) =>
    call<{ started: number; botVersion: number }>(
      `/api/bots/${botId}/drive/run`,
      "POST",
      promptId ? { promptId } : {},
    ),
  restore: (botId: string, version: number, expectedVersion: number) =>
    call<{ version: number }>(`/api/bots/${botId}/revisions/${version}/restore`, "POST", {
      expectedVersion,
    }),
};

export const qualityQueries = {
  /** Under ["conversations", id] so the chat's live topic refreshes the thumbs with the messages. */
  ratings: (conversationId: string) =>
    queryOptions({
      queryKey: ["conversations", conversationId, "feedback"],
      queryFn: async () =>
        (await call<{ feedback: Ratings }>(`/api/conversations/${conversationId}/feedback`))
          .feedback,
    }),
  stats: (botId: string, days: 7 | 30) =>
    queryOptions({
      queryKey: ["bot-quality", "stats", botId, days],
      queryFn: async () =>
        (await call<{ stats: BotStats }>(`/api/bots/${botId}/stats?days=${days}`)).stats,
    }),
  drive: (botId: string) =>
    queryOptions({
      queryKey: ["bot-quality", "drive", botId],
      queryFn: () => call<Drive>(`/api/bots/${botId}/drive`),
    }),
  revisions: (botId: string) =>
    queryOptions({
      queryKey: ["bot-quality", "revisions", botId],
      queryFn: () => call<Revisions>(`/api/bots/${botId}/revisions`),
    }),
};

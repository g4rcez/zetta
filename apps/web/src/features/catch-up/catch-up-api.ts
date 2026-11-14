import { queryOptions } from "@tanstack/react-query";
import type { CatchUpItem, CatchUpSummary } from "@zetta/core/catch-up";
import { call, type Proposal } from "../chat/chat-client";

/** A queue entry: an approval (the same object the chat footer shows) or a decision card. */
export type CatchUpEntry = CatchUpItem<Proposal & { confirm?: "hold" | "click" }>;
export type CatchUpCard = Extract<CatchUpEntry, { source: "card" }>;
export type CatchUpProposal = Extract<CatchUpEntry, { source: "proposal" }>;

/** Every Inbox query starts with this, so one invalidation refreshes the list and the badge. */
export const CATCH_UP_KEY = ["catch-up"] as const;

export const catchUpQueries = {
  list: (bot?: string) =>
    queryOptions({
      queryKey: [...CATCH_UP_KEY, "list", { bot: bot ?? null }] as const,
      queryFn: () =>
        call<{ items: CatchUpEntry[] }>(
          `/api/catch-up${bot ? `?bot=${encodeURIComponent(bot)}` : ""}`,
        ).then((r) => r.items),
    }),
  summary: () =>
    queryOptions({
      queryKey: [...CATCH_UP_KEY, "summary"] as const,
      queryFn: () => call<CatchUpSummary>("/api/catch-up/summary"),
    }),
};

export const catchUpApi = {
  /** Act on a card that is not an approval. `text` is the answer or the nudge, for the kinds that take one. */
  act: (id: string, text?: string) =>
    call<{ ok: true }>(`/api/catch-up/${id}/act`, "POST", text ? { text } : {}),
  deny: (id: string) => call<{ ok: true }>(`/api/catch-up/${id}/deny`, "POST", {}),
};

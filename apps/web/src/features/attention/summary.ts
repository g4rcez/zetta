import { useEffect, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";

import { ApiError, call, chatClient, type AttentionSummary } from "../chat/chat-client";

/** What one bot needs from the user: open items, and how many of those the user has not seen yet. */
export type BotAttention = { open: number; unread: number };
type Item = { botId: string | null; status: string; readAt: string | null };

/** One shared poller for the attention counts (header + sidebar). Polls every 30s while at least one component uses it. */
let state: AttentionSummary | undefined;
let byBot: ReadonlyMap<string, BotAttention> = new Map();
let signedOut = false;
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshAttention(force = false) {
  if (signedOut && !force) return;
  try {
    const [summary, list] = await Promise.all([chatClient.attentionSummary(), call<{ items: Item[] }>("/api/attention")]);
    const next = new Map<string, BotAttention>();
    for (const i of list.items) {
      if (i.botId === null || i.status !== "open") continue;
      const n = next.get(i.botId) ?? { open: 0, unread: 0 };
      next.set(i.botId, { open: n.open + 1, unread: n.unread + (i.readAt ? 0 : 1) });
    }
    state = summary; byBot = next; signedOut = false; emit();
  }
  catch (e) { if (e instanceof ApiError && e.status === 401) { signedOut = true; state = undefined; byBot = new Map(); emit(); } }
}
function subscribe(l: () => void) {
  listeners.add(l);
  if (++subscribers === 1) { void refreshAttention(true); timer = setInterval(() => void refreshAttention(), 30_000); }
  return () => { listeners.delete(l); if (--subscribers === 0 && timer) { clearInterval(timer); timer = undefined; } };
}
/** Number of unread open items (undefined until known or when signed out). */
export function useAttentionSummary(): AttentionSummary | undefined {
  const value = useSyncExternalStore(subscribe, () => state, () => undefined);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => { void refreshAttention(true); }, [pathname]);
  return value;
}
export const attentionLabel = (s?: AttentionSummary) => (s && s.unread > 0 ? `${s.unread} unread` : "");

/** Per-bot attention from the same poll; a bot with nothing open has no entry. */
export function useBotAttention(): ReadonlyMap<string, BotAttention> {
  useAttentionSummary(); // subscribes to the poll; every emit re-renders the caller, which then reads the fresh map
  return byBot;
}

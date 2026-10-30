import { useEffect, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";

import { ApiError, call, chatClient, type AttentionSummary } from "../chat/chat-client";
import { discussionsApi } from "../discussions/discussions-api";

/** What one bot needs from the user: open items, and how many of those the user has not seen yet. */
export type BotAttention = { open: number; unread: number };
type Item = {
  id: string;
  title: string;
  detail: string;
  resultLink: string | null;
  botId: string | null;
  status: string;
  readAt: string | null;
};

const NOTIFIED_KEY = "zetta.notified-attention";
const readNotified = (): Set<string> | undefined => {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : undefined;
  } catch {
    return undefined;
  }
};
const writeNotified = (ids: Set<string>) => {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* storage unavailable: may notify again after reload */
  }
};

export const nativeNotificationState = (): NotificationPermission | "unsupported" =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;
/** Needs a user gesture in most browsers: call it from a click handler. */
export async function enableNativeNotifications() {
  if (nativeNotificationState() === "unsupported") return "unsupported" as const;
  const result = await Notification.requestPermission();
  emit();
  return result;
}

/** One native notification; clicking it focuses the window and opens `link` (an in-app path). */
export function showNative(title: string, body: string, tag: string, link = "/studio/attention") {
  if (nativeNotificationState() !== "granted") return;
  const n = new Notification(title, { body: body.slice(0, 200), tag });
  n.onclick = () => {
    window.focus();
    window.location.assign(/^\/(?!\/)/.test(link) ? link : "/studio/attention");
    n.close();
  };
}

/** Shows one native notification per new unread open item. The first run only records the backlog. */
function notifyNew(items: Item[]) {
  const open = items.filter((i) => i.status === "open" && !i.readAt);
  const seen = readNotified();
  const all = new Set(seen ?? []);
  for (const i of open) all.add(i.id);
  if (seen && nativeNotificationState() === "granted") {
    for (const i of open.filter((x) => !seen.has(x.id))) {
      showNative(i.title, i.detail, i.id, i.resultLink ?? undefined);
    }
  }
  writeNotified(all);
}

/** One shared poller for the rail counts: attention (header + sidebar) and running discussions. Polls every 30s while at least one component uses it. */
let state: AttentionSummary | undefined;
let byBot: ReadonlyMap<string, BotAttention> = new Map();
let running = 0;
let signedOut = false;
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let lastRefresh = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshAttention(force = false) {
  if (signedOut && !force) return;
  lastRefresh = Date.now();
  try {
    const [summary, list, discussions] = await Promise.all([
      chatClient.attentionSummary(),
      call<{ items: Item[] }>("/api/attention"),
      // A failed count keeps the last one, so it never blocks the attention counts.
      discussionsApi.running().catch(() => running),
    ]);
    const next = new Map<string, BotAttention>();
    for (const i of list.items) {
      if (i.botId === null || i.status !== "open") continue;
      const n = next.get(i.botId) ?? { open: 0, unread: 0 };
      next.set(i.botId, { open: n.open + 1, unread: n.unread + (i.readAt ? 0 : 1) });
    }
    notifyNew(list.items);
    state = summary;
    byBot = next;
    running = discussions;
    signedOut = false;
    emit();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      signedOut = true;
      state = undefined;
      byBot = new Map();
      running = 0;
      emit();
    }
  }
}
const onVisible = () => {
  if (!document.hidden) void refreshAttention();
};
function subscribe(l: () => void) {
  listeners.add(l);
  if (++subscribers === 1) {
    void refreshAttention(true);
    // A hidden tab polls at most once a minute (native alerts for new items still arrive), and catches up as soon as it is visible again.
    timer = setInterval(() => {
      if (!document.hidden || Date.now() - lastRefresh >= 55_000) void refreshAttention();
    }, 30_000);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(l);
    if (--subscribers === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}
/** Number of unread open items (undefined until known or when signed out). */
export function useAttentionSummary(): AttentionSummary | undefined {
  const value = useSyncExternalStore(
    subscribe,
    () => state,
    () => undefined,
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    void refreshAttention(true);
  }, [pathname]);
  return value;
}
export const attentionLabel = (s?: AttentionSummary) =>
  s && s.unread > 0 ? `${s.unread} unread` : "";

/** Discussions the bots are working on now, from the same poll. */
export function useRunningDiscussions(): number {
  return useSyncExternalStore(
    subscribe,
    () => running,
    () => 0,
  );
}

/** Per-bot attention from the same poll; a bot with nothing open has no entry. */
export function useBotAttention(): ReadonlyMap<string, BotAttention> {
  useAttentionSummary(); // subscribes to the poll; every emit re-renders the caller, which then reads the fresh map
  return byBot;
}

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
  source: string;
  sourceKey: string | null;
};

/** Runs of the user's routines not opened yet (a running one counts), and the chats they live in. */
type RoutineUnread = { count: number; conversationIds: string[] };

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
let routineUnread = 0;
let routineUnreadChats: ReadonlySet<string> = new Set();
let routineAttention: ReadonlySet<string> = new Set();
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
    const [summary, list, discussions, firstRoutines] = await Promise.all([
      chatClient.attentionSummary(),
      call<{ items: Item[] }>("/api/attention"),
      // A failed count keeps the last one, so it never blocks the attention counts.
      discussionsApi.running().catch(() => running),
      call<RoutineUnread>("/api/routines/unread").catch(() => undefined),
    ]);
    // Cards that point at the chat on screen are seen: mark them read now, so no badge or native alert says it is new.
    const here = window.location.pathname;
    const onScreen = document.hidden
      ? []
      : list.items.filter(
          (i) =>
            i.status === "open" && !i.readAt && i.resultLink === here && here.startsWith("/chat/"),
        );
    await Promise.all(
      onScreen.map((i) =>
        call(`/api/attention/${i.id}/action`, "POST", { action: "read" }).catch(() => {}),
      ),
    );
    const readNow = new Date().toISOString();
    const items = list.items.map((i) => (onScreen.includes(i) ? { ...i, readAt: readNow } : i));
    const next = new Map<string, BotAttention>();
    for (const i of items) {
      if (i.botId === null || i.status !== "open") continue;
      const n = next.get(i.botId) ?? { open: 0, unread: 0 };
      next.set(i.botId, { open: n.open + 1, unread: n.unread + (i.readAt ? 0 : 1) });
    }
    notifyNew(items);
    // A routine with an open or seen-but-not-fixed card still needs the user, whatever its run status is now.
    const needing = new Set<string>();
    for (const i of items) {
      if (i.source !== "routine" || (i.status !== "open" && i.status !== "acknowledged")) continue;
      const id = /^routine:([^:]+):/.exec(i.sourceKey ?? "")?.[1];
      if (id) needing.add(id);
    }
    routineAttention = needing;
    // The routine chat on screen is seen: mark its runs read now, so the badge does not count what the user is looking at.
    let routines = firstRoutines;
    const seen =
      routines && !document.hidden && here.startsWith("/chat/")
        ? routines.conversationIds.find((id) => here === `/chat/${id}`)
        : undefined;
    if (seen) {
      await call("/api/routines/read", "POST", { conversationId: seen }).catch(() => {});
      routines = await call<RoutineUnread>("/api/routines/unread").catch(() => undefined);
    }
    state = { ...summary, unread: Math.max(0, summary.unread - onScreen.length) };
    byBot = next;
    running = discussions;
    routineUnread = routines?.count ?? routineUnread;
    if (routines) routineUnreadChats = new Set(routines.conversationIds);
    signedOut = false;
    emit();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      signedOut = true;
      state = undefined;
      byBot = new Map();
      running = 0;
      routineUnread = 0;
      routineUnreadChats = new Set();
      routineAttention = new Set();
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

/** Routine runs the user has not opened yet, from the same poll; opening the run's chat clears them. */
export function useRoutineUnread(): number {
  useAttentionSummary(); // subscribes to the poll and refreshes on route change, so opening a run's chat clears it at once
  return routineUnread;
}

/** Ids of the routines that have an open Inbox card (failed, blocked or interrupted and not yet resolved). */
export function useRoutineAttention(): ReadonlySet<string> {
  useAttentionSummary(); // subscribes to the poll; every emit re-renders the caller, which then reads the fresh set
  return routineAttention;
}

/** The routine chats that hold runs the user has not opened yet. */
export function useRoutineUnreadChats(): ReadonlySet<string> {
  useAttentionSummary(); // subscribes to the poll; every emit re-renders the caller, which then reads the fresh set
  return routineUnreadChats;
}

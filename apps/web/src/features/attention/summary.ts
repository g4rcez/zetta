import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { ApiError, call, chatClient, type AttentionSummary } from "../chat/chat-client";
import { queryClient } from "@/lib/query-client";
import { pollEvery } from "@/lib/query-policy";
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
  return Notification.requestPermission();
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

/** Everything the rail counts show, fetched together so one request round serves the header, the sidebar and the dashboard. */
type Snapshot = {
  /** The server's counts as a string: the item list is fetched again only when it changes. */
  key: string;
  summary: AttentionSummary | undefined;
  byBot: ReadonlyMap<string, BotAttention>;
  running: number;
  routineUnread: number;
  routineUnreadChats: ReadonlySet<string>;
  routineAttention: ReadonlySet<string>;
};
/** What a signed-out person sees: nothing, and no polling until a route change asks again. */
const EMPTY: Snapshot = {
  key: "",
  summary: undefined,
  byBot: new Map(),
  running: 0,
  routineUnread: 0,
  routineUnreadChats: new Set(),
  routineAttention: new Set(),
};
const KEY = ["attention"] as const;

async function fetchSnapshot(): Promise<Snapshot> {
  const last = queryClient.getQueryData<Snapshot>(KEY) ?? EMPTY;
  try {
    const [summary, discussions, firstRoutines] = await Promise.all([
      chatClient.attentionSummary(),
      // A failed count keeps the last one, so it never blocks the attention counts.
      discussionsApi.running().catch(() => last.running),
      call<RoutineUnread>("/api/routines/unread").catch(() => undefined),
    ]);
    const here = window.location.pathname;
    const key = `${summary.open}:${summary.unread}:${summary.acknowledged}`;
    // The item list is the large payload. Fetch it when the counts moved, on a chat (its cards are marked read), or when alerts are on.
    const needItems =
      last === EMPTY ||
      last.key !== key ||
      here.startsWith("/chat/") ||
      nativeNotificationState() === "granted";
    const list = needItems ? await call<{ items: Item[] }>("/api/attention") : undefined;
    // Cards that point at the chat on screen are seen: mark them read now, so no badge or native alert says it is new.
    const onScreen =
      document.hidden || !list
        ? []
        : list.items.filter(
            (i) =>
              i.status === "open" &&
              !i.readAt &&
              i.resultLink === here &&
              here.startsWith("/chat/"),
          );
    await Promise.all(
      onScreen.map((i) =>
        call(`/api/attention/${i.id}/action`, "POST", { action: "read" }).catch(() => {}),
      ),
    );
    const readNow = new Date().toISOString();
    const items = list?.items.map((i) => (onScreen.includes(i) ? { ...i, readAt: readNow } : i));
    let byBot = last.byBot;
    let routineAttention = last.routineAttention;
    if (items) {
      const bots = new Map<string, BotAttention>();
      for (const i of items) {
        if (i.botId === null || i.status !== "open") continue;
        const n = bots.get(i.botId) ?? { open: 0, unread: 0 };
        bots.set(i.botId, { open: n.open + 1, unread: n.unread + (i.readAt ? 0 : 1) });
      }
      byBot = bots;
      notifyNew(items);
      // A routine with an open or seen-but-not-fixed card still needs the user, whatever its run status is now.
      const needing = new Set<string>();
      for (const i of items) {
        if (i.source !== "routine" || (i.status !== "open" && i.status !== "acknowledged"))
          continue;
        const id = /^routine:([^:]+):/.exec(i.sourceKey ?? "")?.[1];
        if (id) needing.add(id);
      }
      routineAttention = needing;
    }
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
    return {
      key,
      summary: { ...summary, unread: Math.max(0, summary.unread - onScreen.length) },
      byBot,
      running: discussions,
      routineUnread: routines?.count ?? last.routineUnread,
      routineUnreadChats: routines ? new Set(routines.conversationIds) : last.routineUnreadChats,
      routineAttention,
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return EMPTY;
    throw e; // the query keeps the last counts and the next poll tries again
  }
}

/** Reads one slice of the shared snapshot. It polls every 30s (once a minute in a hidden tab, so native alerts still arrive). */
function useSnapshot<T>(select: (s: Snapshot) => T): T | undefined {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchSnapshot,
    select,
    refetchInterval: (q) =>
      q.state.data === EMPTY ? false : document.hidden ? 60_000 : pollEvery(30_000, 30_000, false),
    refetchIntervalInBackground: true,
  }).data;
}

/** Fetches fresh counts now. A signed-out snapshot only refreshes when `force` is set (a route change). */
export function refreshAttention(force = false) {
  if (!force && queryClient.getQueryData(KEY) === EMPTY) return Promise.resolve();
  // `cancelRefetch: false` joins a fetch already running, so many callers in one tick send one request round.
  return queryClient.invalidateQueries({ queryKey: KEY }, { cancelRefetch: false });
}

/** Number of unread open items (undefined until known or when signed out). */
export function useAttentionSummary(): AttentionSummary | undefined {
  const value = useSnapshot((s) => s.summary);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const lastPath = useRef(pathname);
  // Opening a chat clears its badge at once; the first render already fetches, so only a later route change to a chat asks again.
  // Other pages that change attention (a room opened, a routine run) call `refreshAttention` themselves.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (pathname.startsWith("/chat/")) void refreshAttention(true);
  }, [pathname]);
  return value;
}
export const attentionLabel = (s?: AttentionSummary) =>
  s && s.unread > 0 ? `${s.unread} unread` : "";

/** Discussions the bots are working on now, from the same poll. */
export function useRunningDiscussions(): number {
  return useSnapshot((s) => s.running) ?? 0;
}

/** Per-bot attention from the same poll; a bot with nothing open has no entry. */
export function useBotAttention(): ReadonlyMap<string, BotAttention> {
  useAttentionSummary(); // keeps the route-change refresh
  return useSnapshot((s) => s.byBot) ?? EMPTY.byBot;
}

/** Routine runs the user has not opened yet, from the same poll; opening the run's chat clears them. */
export function useRoutineUnread(): number {
  useAttentionSummary();
  return useSnapshot((s) => s.routineUnread) ?? 0;
}

/** Ids of the routines that have an open Inbox card (failed, blocked or interrupted and not yet resolved). */
export function useRoutineAttention(): ReadonlySet<string> {
  useAttentionSummary();
  return useSnapshot((s) => s.routineAttention) ?? EMPTY.routineAttention;
}

/** The routine chats that hold runs the user has not opened yet. */
export function useRoutineUnreadChats(): ReadonlySet<string> {
  useAttentionSummary();
  return useSnapshot((s) => s.routineUnreadChats) ?? EMPTY.routineUnreadChats;
}

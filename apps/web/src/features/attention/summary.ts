import { useQuery } from "@tanstack/react-query";

import { categoryOf, isAttentionKind, notifyOf } from "@zetta/core/attention-kinds";
import { ApiError, call, chatClient, type AttentionSummary, type Bot } from "../chat/chat-client";
import type { CatchUpEntry } from "../catch-up/catch-up-api";
import { queryClient } from "@/lib/query-client";
import { pollEvery } from "@/lib/query-policy";
import { discussionsApi } from "../discussions/discussions-api";

/** What one bot needs from the user: open items, and how many of those the user has not seen yet. */
export type BotAttention = { open: number; unread: number };
/** An attention card that is an update, not a decision (`GET /api/attention`). Only the few that raise a desktop alert are read. */
type Item = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  resultLink: string | null;
  status: string;
  readAt: string | null;
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
export function showNative(title: string, body: string, tag: string, link = "/catch-up") {
  if (nativeNotificationState() !== "granted") return;
  const path = /^\/(?!\/)/.test(link) ? link : "/catch-up";
  const options = { body: body.slice(0, 200), tag, data: { url: path } };
  const direct = () => {
    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        window.location.assign(path);
        n.close();
      };
    } catch {
      /* the browser refuses `new Notification()` and no service worker is there to show it */
    }
  };
  // Phones refuse `new Notification()`. A service worker can show one anywhere, and its click handler (public/sw.js) opens `data.url`.
  const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!worker) return direct();
  void worker
    .getRegistration()
    .then((reg) => (reg ? reg.showNotification(title, options) : direct()))
    .catch(direct);
}

/** One desktop alert: what it says, and the page it opens. `key` says whether it was already shown. */
type Notice = { key: string; title: string; body: string; link: string };

const catchUpLink = (key: string) => `/catch-up?item=${key}`;

/** A decision or an approval, as an alert that opens its own card in Inbox. */
function noticeOf(e: CatchUpEntry): Notice {
  if (e.source === "card")
    return {
      key: e.key,
      title: e.title,
      body: e.detail || e.context.subject || "",
      link: catchUpLink(e.key),
    };
  // An approval carries no title of its own: say who asks and show its first change.
  const asker = queryClient.getQueryData<Bot[]>(["bots"])?.find((b) => b.id === e.botId)?.name;
  const first = e.proposal.diff[0];
  const to = first && (typeof first.to === "string" ? first.to : JSON.stringify(first.to));
  return {
    key: e.key,
    title: `${asker ?? "A bot"} needs your approval`,
    body: first ? `${first.field}: ${to}` : "",
    link: catchUpLink(e.key),
  };
}

/** Updates (not decisions) that still raise an alert, such as an agenda reminder. */
const updateNotices = (items: Item[]): Notice[] =>
  items
    .filter(
      (i) =>
        i.status === "open" &&
        !i.readAt &&
        isAttentionKind(i.kind) &&
        categoryOf(i.kind) === "fyi" &&
        notifyOf(i.kind) === "native",
    )
    .map((i) => ({
      key: i.id,
      title: i.title,
      body: i.detail,
      link: i.resultLink ?? "/catch-up",
    }));

/** Shows one desktop alert per notice not shown before. The first run only records the backlog. */
function notifyNew(notices: Notice[]) {
  const seen = readNotified();
  const all = new Set(seen ?? []);
  for (const n of notices) all.add(n.key);
  if (seen && nativeNotificationState() === "granted") {
    for (const n of notices.filter((x) => !seen.has(x.key)))
      showNative(n.title, n.body, n.key, n.link);
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

const ROUTINE_KINDS = ["routine_failed", "routine_blocked", "routine_interrupted"];

async function fetchSnapshot(): Promise<Snapshot> {
  const last = queryClient.getQueryData<Snapshot>(KEY) ?? EMPTY;
  try {
    const [queue, updates, discussions, firstRoutines] = await Promise.all([
      // The queue is built on the server in one pass, so it is the only list asked for on every poll.
      call<{ items: CatchUpEntry[] }>("/api/catch-up").then((r) => r.items),
      chatClient.attentionSummary(),
      // A failed count keeps the last one, so it never blocks the attention counts.
      discussionsApi.running().catch(() => last.running),
      call<RoutineUnread>("/api/routines/unread").catch(() => undefined),
    ]);
    const here = window.location.pathname;
    const key = `${updates.open}:${updates.unread}:${updates.acknowledged}`;
    // The update cards are read only for their desktop alerts: when their counts moved, or when alerts are on.
    const needUpdates =
      last === EMPTY || last.key !== key || nativeNotificationState() === "granted";
    const updateList = needUpdates
      ? await call<{ items: Item[] }>("/api/attention")
          .then((r) => r.items)
          .catch(() => [] as Item[])
      : [];
    notifyNew([...queue.map(noticeOf), ...(updateList.length ? updateNotices(updateList) : [])]);
    const byBot = new Map<string, BotAttention>();
    for (const e of queue) {
      if (!e.botId) continue;
      const n = byBot.get(e.botId)?.open ?? 0;
      byBot.set(e.botId, { open: n + 1, unread: n + 1 });
    }
    // A routine with a decision waiting still needs the person, whatever its run status is now.
    const routineAttention = new Set<string>();
    for (const e of queue)
      if (e.source === "card" && ROUTINE_KINDS.includes(e.kind) && e.subjectId)
        routineAttention.add(e.subjectId);
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
      // What waits for a decision. `unread` is the same number: a decision is either waiting or done.
      summary: { open: queue.length, unread: queue.length, acknowledged: 0 },
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

/** How many decisions wait for the person (undefined until known or when signed out). */
export function useAttentionSummary(): AttentionSummary | undefined {
  return useSnapshot((s) => s.summary);
}
export const attentionLabel = (s?: AttentionSummary) =>
  s && s.unread > 0 ? `${s.unread} waiting` : "";

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

/** Ids of the routines that have a decision waiting in Inbox (failed, blocked or interrupted and not yet decided). */
export function useRoutineAttention(): ReadonlySet<string> {
  useAttentionSummary();
  return useSnapshot((s) => s.routineAttention) ?? EMPTY.routineAttention;
}

/** The routine chats that hold runs the user has not opened yet. */
export function useRoutineUnreadChats(): ReadonlySet<string> {
  useAttentionSummary();
  return useSnapshot((s) => s.routineUnreadChats) ?? EMPTY.routineUnreadChats;
}

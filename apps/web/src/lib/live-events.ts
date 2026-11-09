import { topics } from "@zetta/core/live-topics";
import { useEffect } from "react";

import { ENV } from "../env";
import { queryClient } from "./query-client";
import { setLive } from "./query-policy";

type Key = readonly unknown[];

/** The queries to refetch for one topic. Only queries that are on screen refetch; the others wait until they are used. */
export function keysFor(topic: string): { queryKey: Key; exact?: boolean }[] {
  const [kind, id] = topic.split(":") as [string, string | undefined];
  if (kind === "conversation" && id) return [{ queryKey: ["conversations", id], exact: false }]; // messages, loops and turn of that chat
  if (topic === topics.conversations) return [{ queryKey: ["conversations", "list"], exact: true }];
  if (topic === topics.rooms)
    return [
      { queryKey: ["discussions", "list"], exact: true },
      { queryKey: ["discussions", "running"], exact: true },
    ];
  if (kind === "discussion" && id) {
    // Detail and steps, the room's transcript (its conversation is known once the room was opened) and what its bots proposed.
    const cached = queryClient.getQueryData<{ discussion: { conversationId: string } }>([
      "discussions",
      id,
    ]);
    return [
      { queryKey: ["discussions", id] },
      ...(cached
        ? [
            {
              queryKey: ["conversations", cached.discussion.conversationId, "messages"],
              exact: true,
            },
          ]
        : []),
      { queryKey: ["proposals"] },
    ];
  }
  if (topic === topics.botStatus) return [{ queryKey: ["bots", "status"], exact: true }];
  if (topic === topics.bots) return [{ queryKey: ["bots"], exact: true }];
  if (topic === topics.attention) return [{ queryKey: ["attention"], exact: true }];
  // Paused or resumed here or on another device: the preferences carry the state.
  if (topic === topics.agents) return [{ queryKey: ["preferences"], exact: true }];
  if (topic === topics.routines) return [{ queryKey: ["routines"] }];
  if (topic === topics.proposals) return [{ queryKey: ["proposals"] }];
  // An app was published, changed or rolled back, or one of its calls started, waited for approval or finished.
  if (topic === topics.apps) return [{ queryKey: ["apps"] }];
  // A run started or ended, or the playground changed: refetch the ones on screen (detail, runs, the run).
  if (kind === "playground" && id) return [{ queryKey: ["playground"] }];
  if (topic === topics.resync) return [{ queryKey: [] }]; // every query on screen
  return [];
}

const COALESCE_MS = 250;
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;
/** A hidden tab keeps the stream this long, so switching tabs back and forth never reconnects. */
export const HIDDEN_GRACE_MS = 30_000;
const NAME = "zetta:live-events";

// `bun --hot` / Vite reload modules: the holder outlives them, so an old connection can still be closed.
const holder = globalThis as { zettaLiveEvents?: () => void };

/** What tabs say to each other: the leader forwards topics and its state, a new tab asks for the state. */
type TabMessage =
  | { kind: "topics"; topics: string[] }
  | { kind: "live"; live: boolean }
  | { kind: "hello" };

/**
 * One `EventSource` to `GET /api/events` per browser, not per tab. The tabs elect a leader through a Web Lock; the leader holds the
 * stream and hands each topic to the other tabs over a `BroadcastChannel`. Every tab refetches the matching queries once per 250 ms
 * burst. Topics only, never data. If the leader goes away, the next visible tab takes over and refetches everything once (it may have
 * missed events). A hidden tab gives the stream up only after `HIDDEN_GRACE_MS`. Without Web Locks (an insecure context), each tab
 * keeps its own stream. If the stream cannot connect, the polls keep their normal fast intervals (see `pollEvery`).
 */
export function connectLiveEvents() {
  const doc = document; // the same one at cleanup, whatever the globals are by then
  const shared = typeof BroadcastChannel !== "undefined" && !!globalThis.navigator?.locks;
  const channel = shared ? new BroadcastChannel(NAME) : undefined;
  let source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let flush: ReturnType<typeof setTimeout> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let gap = false; // events may have been missed since the stream last worked
  let leader = !shared; // holds the stream: always true without sharing
  let release: (() => void) | undefined; // lets go of the Web Lock
  let waiting: AbortController | undefined; // a pending request for the Web Lock
  let streamLive = false;
  let heardLeader = false; // another tab held the stream before us: we may have missed events across the hand-over
  let disposed = false;
  let shuttingDown = false; // the page is being hidden for good (closed, reloaded, navigated away); `pageshow` can undo it
  let starter: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();

  const post = (message: TabMessage) => {
    if (leader) channel?.postMessage(message);
  };
  const live = (value: boolean) => {
    streamLive = value;
    setLive(value);
    post({ kind: "live", live: value });
  };
  const queue = (topics: Iterable<string>) => {
    for (const topic of topics) pending.add(topic);
    flush ??= setTimeout(run, COALESCE_MS);
  };
  const run = () => {
    flush = undefined;
    for (const topic of pending)
      for (const { queryKey, exact } of keysFor(topic))
        // Join a refetch that is already running instead of cancelling it.
        void queryClient.invalidateQueries(
          { queryKey, ...(exact ? { exact } : {}) },
          { cancelRefetch: false },
        );
    pending.clear();
  };
  const closeStream = () => {
    clearTimeout(retry);
    retry = undefined;
    source?.close();
    source = undefined;
    live(false);
  };
  const open = () => {
    if (source || disposed || shuttingDown || !leader) return;
    const next = new EventSource(new URL("/api/events", ENV.VITE_SERVER_URL), {
      withCredentials: true,
    });
    source = next;
    next.onopen = () => {
      attempt = 0;
      live(true);
      // A reconnect, or a new leader, may have missed what happened in between.
      if (gap) {
        gap = false;
        queue([topics.resync]);
        post({ kind: "topics", topics: [topics.resync] });
      }
    };
    next.onmessage = (e: MessageEvent<string>) => {
      try {
        const { topic } = JSON.parse(e.data) as { topic?: unknown };
        if (typeof topic !== "string") return;
        queue([topic]);
        post({ kind: "topics", topics: [topic] });
      } catch {
        /* not one of ours */
      }
    };
    // The server closed this stream because the person has too many open elsewhere: do not fight for it. Wait, or until the tab is shown again.
    next.addEventListener("evicted", () => {
      if (source !== next) return;
      closeStream();
      gap = true;
      retry = setTimeout(open, RETRY_MAX_MS);
    });
    next.onerror = () => {
      // The browser retries on its own after a network error. A refusal (signed out, route missing) closes it for good: retry later.
      live(false);
      gap = true;
      if (next.readyState !== EventSource.CLOSED) return;
      source = undefined;
      retry = setTimeout(open, Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt++));
    };
  };

  /** Asks for the Web Lock. The tab that gets it owns the stream until it lets go. */
  const acquire = () => {
    if (!shared || leader || waiting || disposed || shuttingDown) return;
    const controller = (waiting = new AbortController());
    navigator.locks
      .request(
        NAME,
        { signal: controller.signal },
        () =>
          new Promise<void>((resolve) => {
            waiting = undefined;
            if (disposed || shuttingDown) return resolve(); // the tab went away while the request was in flight: do not take the stream
            leader = true;
            release = resolve;
            if (heardLeader) gap = true;
            heardLeader = false;
            setLive(false);
            open();
          }),
      )
      .catch(() => {}) // aborted while waiting
      .finally(() => {
        if (waiting === controller) waiting = undefined;
      });
  };
  const resign = () => {
    waiting?.abort();
    waiting = undefined;
    if (!leader || !shared) return;
    closeStream(); // tells the other tabs the stream is gone
    leader = false;
    release?.();
    release = undefined;
  };

  const onVisibility = () => {
    clearTimeout(hiddenTimer);
    hiddenTimer = undefined;
    if (doc.hidden) {
      hiddenTimer = setTimeout(() => (shared ? resign() : closeStream()), HIDDEN_GRACE_MS);
      return;
    }
    if (shared) acquire();
    open();
  };

  if (channel) {
    channel.onmessage = (e: MessageEvent<TabMessage>) => {
      const m = e.data;
      if (m?.kind === "topics" && Array.isArray(m.topics)) queue(m.topics);
      else if (m?.kind === "live" && !leader) {
        heardLeader = true;
        setLive(m.live);
      } else if (m?.kind === "hello" && leader) post({ kind: "live", live: streamLive });
    };
  }
  /** The page is going away: close the stream and let go of the lock now, so another tab takes over without waiting for the browser. */
  const onPageHide = () => {
    shuttingDown = true;
    clearTimeout(hiddenTimer);
    clearTimeout(starter);
    if (shared) resign();
    else closeStream();
  };
  /** A page restored from the back/forward cache comes back alive without running the app again: connect once more. */
  const onPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted || disposed || !shuttingDown) return;
    shuttingDown = false;
    if (doc.hidden) return;
    if (shared) acquire();
    open();
  };
  const win = typeof window === "undefined" ? undefined : window;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (holder.zettaLiveEvents === dispose) holder.zettaLiveEvents = undefined;
    doc.removeEventListener("visibilitychange", onVisibility);
    win?.removeEventListener("pagehide", onPageHide);
    win?.removeEventListener("pageshow", onPageShow);
    clearTimeout(starter);
    clearTimeout(flush);
    clearTimeout(hiddenTimer);
    clearTimeout(retry);
    if (shared) resign();
    else closeStream();
    setLive(false);
    channel?.close();
  };

  // Only one connection lives at a time (a hot reload, a second mount): the older one lets go first.
  holder.zettaLiveEvents?.();
  holder.zettaLiveEvents = dispose;
  doc.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("pagehide", onPageHide);
  win?.addEventListener("pageshow", onPageShow as EventListener);
  // Start on the next tick. React in development mounts, unmounts and mounts again at once; the unmount cancels this, so the
  // throwaway first mount never opens a request (which the server would see as a stream that opens and aborts).
  starter = setTimeout(() => {
    starter = undefined;
    if (disposed || shuttingDown) return;
    channel?.postMessage({ kind: "hello" } satisfies TabMessage);
    if (doc.hidden) return;
    acquire();
    open();
  }, 0);
  return dispose;
}

/** Mount once in the signed-in layout. */
export function useLiveEvents() {
  useEffect(connectLiveEvents, []);
}

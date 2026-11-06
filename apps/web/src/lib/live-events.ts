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
  if (topic === topics.resync) return [{ queryKey: [] }]; // every query on screen
  return [];
}

const COALESCE_MS = 250;
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * One `EventSource` to `GET /api/events` while the tab is visible. It receives topics, never data, and refetches the matching queries
 * once per 250 ms burst. A hidden tab closes it (the next focus refetches what went stale). If it cannot connect, the polls keep
 * their normal fast intervals (see `pollEvery`).
 */
function connect() {
  let source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let flush: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let gap = false; // events may have been missed since the stream last worked
  const pending = new Set<string>();

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
  const close = () => {
    clearTimeout(retry);
    source?.close();
    source = undefined;
    setLive(false);
  };
  const open = () => {
    if (source || document.hidden) return;
    const next = new EventSource(new URL("/api/events", ENV.VITE_SERVER_URL), {
      withCredentials: true,
    });
    source = next;
    next.onopen = () => {
      attempt = 0;
      setLive(true);
      // A reconnect may land on another server and miss what happened in between.
      if (gap) {
        gap = false;
        pending.add(topics.resync);
        flush ??= setTimeout(run, COALESCE_MS);
      }
    };
    next.onmessage = (e: MessageEvent<string>) => {
      try {
        const { topic } = JSON.parse(e.data) as { topic?: unknown };
        if (typeof topic === "string") pending.add(topic);
      } catch {
        return; // not one of ours
      }
      flush ??= setTimeout(run, COALESCE_MS);
    };
    next.onerror = () => {
      // The browser retries on its own after a network error. A refusal (signed out, route missing) closes it for good: retry later.
      setLive(false);
      gap = true;
      if (next.readyState !== EventSource.CLOSED) return;
      source = undefined;
      retry = setTimeout(open, Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt++));
    };
  };
  const onVisibility = () => (document.hidden ? close() : open());
  document.addEventListener("visibilitychange", onVisibility);
  open();
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    clearTimeout(flush);
    close();
  };
}

/** Mount once in the signed-in layout. */
export function useLiveEvents() {
  useEffect(connect, []);
}

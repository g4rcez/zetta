import { useSyncExternalStore } from "react";

import { ApiError, chatClient, type BotStatusEntry } from "../chat/chat-client";

/**
 * One shared poller for every bot status on screen (sidebar, header, mentions). It runs only while a component uses it:
 * every 5s with the tab visible, once a minute when hidden, and again as soon as the tab is visible.
 */
const VISIBLE_MS = 5_000;
const HIDDEN_MS = 60_000;

let byBot: ReadonlyMap<string, BotStatusEntry> = new Map();
let signedOut = false;
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let lastRefresh = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshBotStatus() {
  if (signedOut || subscribers === 0) return;
  lastRefresh = Date.now();
  try {
    const statuses = await chatClient.botStatuses();
    byBot = new Map(statuses.map((s) => [s.botId, s]));
    emit();
  } catch (e) {
    // Any other failure keeps the last known statuses: a dot that goes stale is better than one that disappears.
    if (e instanceof ApiError && e.status === 401) {
      signedOut = true;
      byBot = new Map();
      emit();
    }
  }
}
const tick = () => {
  if (!document.hidden || Date.now() - lastRefresh >= HIDDEN_MS - 5_000) void refreshBotStatus();
};
const onVisible = () => {
  if (!document.hidden) {
    signedOut = false;
    void refreshBotStatus();
  }
};
function subscribe(l: () => void) {
  listeners.add(l);
  if (++subscribers === 1) {
    signedOut = false;
    void refreshBotStatus();
    timer = setInterval(tick, VISIBLE_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(l);
    if (--subscribers === 0) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** The status of one bot, or undefined until the first answer arrives (no dot is shown then). */
export function useBotStatus(botId: string | undefined): BotStatusEntry | undefined {
  const map = useSyncExternalStore(
    subscribe,
    () => byBot,
    () => byBot,
  );
  return botId ? map.get(botId) : undefined;
}

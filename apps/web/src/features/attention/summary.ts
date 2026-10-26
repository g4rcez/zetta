import { useEffect, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";

import { ApiError, chatClient, type AttentionSummary } from "../chat/chat-client";

/** One shared poller for the attention counts (header + sidebar). Polls every 30s while at least one component uses it. */
let state: AttentionSummary | undefined;
let signedOut = false;
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshAttention(force = false) {
  if (signedOut && !force) return;
  try { state = await chatClient.attentionSummary(); signedOut = false; emit(); }
  catch (e) { if (e instanceof ApiError && e.status === 401) { signedOut = true; state = undefined; emit(); } }
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

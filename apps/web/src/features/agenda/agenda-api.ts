import { useCallback, useEffect, useState } from "react";

import { call, errorMessage } from "../chat/chat-client";

export const AGENDA_KINDS = ["event", "task", "reminder", "note"] as const;
export type AgendaKind = (typeof AGENDA_KINDS)[number];
export type AgendaItem = {
  id: string;
  kind: AgendaKind;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  timezone: string;
  status: "open" | "done" | "cancelled";
  remindAt: string | null;
  source: "user" | "bot" | "google";
  createdByBotId: string | null;
  conversationId: string | null;
  googleEventId: string | null;
  syncToGoogle: boolean;
  syncState: "local" | "synced" | "pending_push" | "pending_delete" | "error";
  syncError: string;
  version: number;
};
export type AgendaDraft = {
  kind: AgendaKind;
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  timezone?: string;
  remindAt?: string | null;
  syncToGoogle?: boolean;
};
export type AgendaSync = {
  enabled: boolean;
  pushByDefault: boolean;
  pushAccount: string | null;
  lastSyncedAt: string | null;
  lastError: string;
};

export const agendaApi = {
  list: (from: Date, to: Date) =>
    call<{ items: AgendaItem[] }>(
      `/api/agenda?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`,
    ).then((r) => r.items),
  get: (id: string) => call<{ item: AgendaItem }>(`/api/agenda/${id}`).then((r) => r.item),
  create: (v: AgendaDraft) =>
    call<{ item: AgendaItem }>("/api/agenda", "POST", v).then((r) => r.item),
  update: (
    id: string,
    expectedVersion: number,
    v: Partial<AgendaDraft> & { status?: AgendaItem["status"] },
  ) =>
    call<{ item: AgendaItem }>(`/api/agenda/${id}`, "PATCH", { expectedVersion, ...v }).then(
      (r) => r.item,
    ),
  complete: (id: string, done: boolean) =>
    call<{ item: AgendaItem }>(`/api/agenda/${id}/complete`, "POST", { done }).then((r) => r.item),
  remove: (id: string) => call<{ item: AgendaItem }>(`/api/agenda/${id}`, "DELETE"),
  sync: () => call<{ sync: AgendaSync }>("/api/agenda/sync").then((r) => r.sync),
  setSync: (v: Partial<Pick<AgendaSync, "enabled" | "pushByDefault" | "pushAccount">>) =>
    call<{ sync: AgendaSync }>("/api/agenda/sync", "PUT", v).then((r) => r.sync),
  syncNow: () =>
    call<{
      result: { ok: boolean; error?: string; pulled?: number; pushed?: number; readOnly?: boolean };
      sync: AgendaSync;
    }>("/api/agenda/sync/now", "POST", {}),
};

/** PageCalendar keeps its own visible date, so the page loads a wide window around today and can widen it on request. */
export function useAgenda(window: { from: Date; to: Date }, onError: (m: string) => void) {
  const [items, setItems] = useState<AgendaItem[]>();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    agendaApi
      .list(window.from, window.to)
      .then((r) => {
        if (alive) setItems(r);
      })
      .catch((e) => {
        if (alive) {
          setItems((x) => x ?? []);
          onError(errorMessage(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [window.from, window.to, tick, onError]);
  // Bots and Google sync change the Agenda in the background: refresh while the page is visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 60_000);
    return () => clearInterval(t);
  }, [reload]);
  return { items, reload, setItems };
}

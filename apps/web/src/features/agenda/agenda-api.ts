import { keepPreviousData, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

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

/** Every key starts with "agenda", so one invalidation after a write refreshes the list, the item and the sync state. */
export const agendaQueries = {
  list: (from: Date, to: Date) =>
    queryOptions({
      queryKey: ["agenda", "list", { from: from.toISOString(), to: to.toISOString() }],
      queryFn: () => agendaApi.list(from, to),
    }),
  detail: (id: string) =>
    queryOptions({ queryKey: ["agenda", id], queryFn: () => agendaApi.get(id) }),
  sync: () => queryOptions({ queryKey: ["agenda", "sync"], queryFn: () => agendaApi.sync() }),
};

/** PageCalendar keeps its own visible date, so the page loads a wide window around today and can widen it on request. */
export function useAgenda(window: { from: Date; to: Date }, onError: (m: string) => void) {
  const qc = useQueryClient();
  const query = useQuery({
    ...agendaQueries.list(window.from, window.to),
    // Bots and Google sync change the Agenda in the background: refresh while the page is visible.
    refetchInterval: 60_000,
    // Widening the window keeps the rows on screen until the new ones arrive.
    placeholderData: keepPreviousData,
  });
  const error = query.error;
  useEffect(() => {
    if (error) onError(errorMessage(error));
  }, [error, onError]);
  const reload = useCallback(() => qc.invalidateQueries({ queryKey: ["agenda"] }), [qc]);
  const key = agendaQueries.list(window.from, window.to).queryKey;
  const setItems = useCallback(
    (next: AgendaItem[]) => qc.setQueryData<AgendaItem[]>(key, next),
    // The key holds the window as text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, JSON.stringify(key)],
  );
  return { items: query.data ?? (query.isError ? NO_ITEMS : undefined), reload, setItems };
}

const NO_ITEMS: AgendaItem[] = [];

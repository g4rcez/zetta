import { PageCalendar, type CalendarEvent, type CalendarFilter } from "@g4rcez/components";
import { CheckIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/notify";

import { IconHint } from "@/components/icon-hint";
import { Button } from "@/components/ui";

import {
  agendaQueries,
  useAgenda,
  type AgendaItem,
  type AgendaKind,
  type AgendaSync,
} from "./agenda-api";
import { AgendaItemModal } from "./agenda-item-modal";
import { KIND_ICON, KIND_LABEL, KIND_THEME, pillTheme } from "./agenda-kinds";
import { AgendaSyncPanel } from "./agenda-sync";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatTime } from "@/features/preferences/time-format";

type Ev = CalendarEvent<{ id: string; date: Date; item: AgendaItem }>;
const MONTH_MS = 31 * 86_400_000;
const DONE_THEME = "neutral";
const FILTERS: CalendarFilter[] = [
  ...(Object.keys(KIND_LABEL) as AgendaKind[]).map((k) => ({
    id: k,
    label: KIND_LABEL[k],
    enabled: true,
    theme: KIND_THEME[k],
  })),
  { id: "done", label: "Done", enabled: true, theme: DONE_THEME },
];
const SYNC_OFF: AgendaSync = {
  enabled: false,
  pushByDefault: false,
  pushAccount: null,
  lastSyncedAt: null,
  lastError: "",
};
const startOfMonth = (d: Date, add = 0) => new Date(d.getFullYear(), d.getMonth() + add, 1);
/** All-day items are stored at UTC midnight; the calendar groups by local day, so they are placed on that calendar date locally. */
const displayDate = (i: AgendaItem) => {
  const d = new Date(i.startAt);
  return i.allDay ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d;
};

export function AgendaPage({ focusId }: { focusId?: string | undefined }) {
  const onError = useCallback((m: string) => toast.error(m), []);
  const [window, setWindow] = useState(() => ({
    from: startOfMonth(new Date(), -2),
    to: startOfMonth(new Date(), 4),
  }));
  const { items, reload } = useAgenda(window, onError);
  const qc = useQueryClient();
  const syncQuery = useQuery(agendaQueries.sync());
  const sync = syncQuery.data ?? (syncQuery.isError ? SYNC_OFF : undefined);
  const setSync = (next: AgendaSync) => qc.setQueryData(agendaQueries.sync().queryKey, next);
  const [editing, setEditing] = useState<{ item?: AgendaItem; at?: Date }>();
  // Opened from an attention item or a chat receipt (/agenda?item=<id>).
  useEffect(() => {
    if (!focusId) return;
    qc.fetchQuery(agendaQueries.detail(focusId)).then(
      (item) => setEditing({ item }),
      () => onError("That Agenda item no longer exists."),
    );
  }, [focusId, onError, qc]);

  const events = useMemo<Ev[]>(
    () =>
      (items ?? []).map((i) => ({
        id: i.id,
        date: displayDate(i),
        item: i,
        title: i.status === "done" ? `✓ ${i.title}` : i.title,
        filterId: i.status === "done" ? "done" : i.kind,
        className: `${pillTheme(i.status === "done" ? DONE_THEME : KIND_THEME[i.kind])} ${i.syncState === "error" ? "ring-1 ring-destructive" : ""}`,
      })),
    [items],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-4 md:px-6">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Your tasks, reminders, events and notes. Your bots add to it from conversations.
          </p>
        </div>
        <AgendaSyncPanel sync={sync} onSync={setSync} onSynced={reload} onError={onError} />
      </div>
      <div className="flex min-h-[32rem] flex-1 flex-col">
        <PageCalendar<Ev & { id: string; date: Date }>
          events={events}
          loading={items === undefined}
          defaultView="week"
          filters={FILTERS}
          onAddEvent={() => setEditing({})}
          onSlotClick={(date) => setEditing({ at: date })}
          onEventClick={(e) => setEditing({ item: (e as Ev).item })}
          renderEvent={(e) => <AgendaEventLabel item={e.item} />}
        />
      </div>
      <div className="flex shrink-0 justify-between text-xs text-muted-foreground">
        <Button
          variant="link"
          size="xs"
          onClick={() =>
            setWindow((w) => ({ ...w, from: new Date(w.from.getTime() - 3 * MONTH_MS) }))
          }
        >
          Load earlier months
        </Button>
        <span>
          Showing {window.from.toLocaleDateString()} – {window.to.toLocaleDateString()}
        </span>
        <Button
          variant="link"
          size="xs"
          onClick={() => setWindow((w) => ({ ...w, to: new Date(w.to.getTime() + 3 * MONTH_MS) }))}
        >
          Load later months
        </Button>
      </div>
      {editing && (
        <AgendaItemModal
          item={editing.item}
          at={editing.at}
          syncEnabled={Boolean(sync?.enabled)}
          onClose={() => setEditing(undefined)}
          onSaved={reload}
          onError={onError}
        />
      )}
    </div>
  );
}

function AgendaEventLabel({ item }: { item: AgendaItem }) {
  const tf = useTimeFormat();
  const Icon = KIND_ICON[item.kind];
  const time = item.allDay ? "All day" : formatTime(item.startAt, tf);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {/* Static text in the day detail panel (no link or button around it), so `IconHint` fits. */}
      {item.status === "done" ? (
        <IconHint label="Done">
          <CheckIcon className="size-3.5 shrink-0" />
        </IconHint>
      ) : (
        <IconHint label={KIND_LABEL[item.kind]}>
          <Icon className="size-3.5 shrink-0" />
        </IconHint>
      )}
      <span className="shrink-0 tabular-nums text-xs opacity-80">{time}</span>
      <span className={`truncate ${item.status === "done" ? "line-through" : ""}`}>
        {item.title}
      </span>
      {item.googleEventId && (
        <span className="ml-auto shrink-0 rounded bg-muted px-1 text-xs" title="On Google Calendar">
          G
        </span>
      )}
    </span>
  );
}

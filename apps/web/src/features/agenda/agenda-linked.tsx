import { CalendarIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime, formatTime } from "@/features/preferences/time-format";

import { Modal } from "../shared/ui";
import type { LinkedEvent } from "./agenda-api";

/** An event of the user's calendar link with the name of that calendar. */
export type LinkedShown = LinkedEvent & { calendar: string };

/** The pill of a linked event in the calendar: marked "Link" so it reads as not editable here. */
export function LinkedEventLabel({ event }: { event: LinkedShown }) {
  const tf = useTimeFormat();
  const time = event.allDay ? "All day" : formatTime(event.startAt, tf);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <CalendarIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 tabular-nums text-xs opacity-80">{time}</span>
      <span className="truncate">{event.title}</span>
      <span className="ml-auto shrink-0 rounded bg-muted px-1 text-xs">
        Link<span className="sr-only">, read-only calendar link event</span>
      </span>
    </span>
  );
}

/** Details of a linked event. Plain text only: the feed's words are somebody else's, and nothing here can change them. */
export function LinkedEventModal({ event, onClose }: { event: LinkedShown; onClose: () => void }) {
  const tf = useTimeFormat();
  const when = event.allDay
    ? event.startAt.slice(0, 10)
    : `${formatDateTime(event.startAt, tf)}${event.endAt ? ` – ${formatTime(event.endAt, tf)}` : ""}`;
  return (
    <Modal title={event.title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          From the calendar link “{event.calendar}”. It is read-only: change it in the calendar it
          comes from.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-muted-foreground">When</dt>
          <dd>
            {when}
            {event.recurring ? " (repeats)" : ""}
          </dd>
          {event.location && (
            <>
              <dt className="text-muted-foreground">Where</dt>
              <dd className="break-words">{event.location}</dd>
            </>
          )}
        </dl>
        {event.description && (
          <p className="max-h-60 overflow-auto whitespace-pre-wrap break-words">
            {event.description}
          </p>
        )}
        <div className="flex justify-end pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

import { CalendarCheck2, CalendarDays, BellRing, StickyNote, type LucideIcon } from "lucide-react";

import type { AgendaKind } from "./agenda-api";

export const KIND_LABEL: Record<AgendaKind, string> = { event: "Event", task: "Task", reminder: "Reminder", note: "Note" };
export const KIND_ICON: Record<AgendaKind, LucideIcon> = { event: CalendarDays, task: CalendarCheck2, reminder: BellRing, note: StickyNote };
export const KIND_THEME = { event: "primary", task: "success", reminder: "warn", note: "muted" } as const satisfies Record<AgendaKind, string>;
/** Event pill colours per kind (Tailwind classes on the library's pill). */
export const KIND_CLASS: Record<AgendaKind, string> = {
  event: "border-l-2 border-l-primary",
  task: "border-l-2 border-l-emerald-500",
  reminder: "border-l-2 border-l-amber-500",
  note: "border-l-2 border-l-muted-foreground",
};

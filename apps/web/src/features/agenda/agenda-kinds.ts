import {
  CalendarCheckIcon,
  CalendarIcon,
  BellRingingIcon,
  NoteIcon,
  type Icon,
} from "@phosphor-icons/react";

import type { AgendaKind } from "./agenda-api";

export const KIND_LABEL: Record<AgendaKind, string> = {
  event: "Event",
  task: "Task",
  reminder: "Reminder",
  note: "Note",
};
export const KIND_ICON: Record<AgendaKind, Icon> = {
  event: CalendarIcon,
  task: CalendarCheckIcon,
  reminder: BellRingingIcon,
  note: NoteIcon,
};
export const KIND_THEME = {
  event: "primary",
  task: "success",
  reminder: "warn",
  note: "muted",
} as const satisfies Record<AgendaKind, string>;
/** PageCalendar pills are library Buttons: a className switches them to the `raw` theme, so pass the Button theme class matching the filter chip. */
export const pillTheme = (theme: string) => `__button--theme-${theme}`;

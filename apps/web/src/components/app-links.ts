import {
  SquaresFourIcon,
  CalendarDotsIcon,
  BellIcon,
  CalendarIcon,
  FileArchiveIcon,
  GaugeIcon,
  KanbanIcon,
  ChatsIcon,
  DevicesIcon,
  TreeStructureIcon,
  PlugIcon,
  HashIcon,
} from "@phosphor-icons/react";

/** Main rail destinations, in rail order (the command palette binds Alt+1… to them in this order). Each `group` is one contiguous run, rendered as a labelled section. */
export const appLinks = [
  { to: "/chat/{-$chatId}", group: "Work", label: "Chat", icon: ChatsIcon },
  { to: "/rooms", group: "Work", label: "Rooms", icon: HashIcon },
  { to: "/agenda", group: "Work", label: "Agenda", icon: CalendarIcon },
  {
    to: "/studio/$tab",
    params: { tab: "attention" },
    group: "Work",
    label: "Inbox",
    icon: BellIcon,
  },
  { to: "/studio", group: "Build", label: "Studio", icon: SquaresFourIcon },
  {
    to: "/studio/$tab",
    params: { tab: "routines" },
    group: "Build",
    label: "Routines",
    icon: CalendarDotsIcon,
  },
  {
    to: "/studio/$tab",
    params: { tab: "plugins" },
    group: "Build",
    label: "Plugins",
    icon: PlugIcon,
  },
  {
    to: "/studio/$tab",
    params: { tab: "computer" },
    group: "Build",
    label: "Computer",
    icon: DevicesIcon,
  },
  { to: "/dashboard", group: "Oversee", label: "Dashboard", icon: GaugeIcon },
  { to: "/tasks", group: "Oversee", label: "Tasks", icon: KanbanIcon },
  { to: "/teams", group: "Oversee", label: "Teams", icon: TreeStructureIcon },
  { to: "/artifacts", group: "Oversee", label: "Artifacts", icon: FileArchiveIcon },
] as const;

import {
  Blocks,
  CalendarClock,
  Bell,
  CalendarDays,
  FileBox,
  Gauge,
  KanbanSquare,
  MessagesSquare,
  MonitorSmartphone,
  Network,
  Plug,
  UsersRound,
} from "lucide-react";

/** Main rail destinations, in rail order (the command palette binds Alt+1… to them in this order). */
export const appLinks = [
  { to: "/chat/{-$chatId}", label: "Chat", icon: MessagesSquare },
  { to: "/discussions", label: "Discussions", icon: UsersRound },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/studio/$tab", params: { tab: "attention" }, label: "Notifications", icon: Bell },
  { to: "/studio", label: "Studio", icon: Blocks },
  { to: "/studio/$tab", params: { tab: "routines" }, label: "Routines", icon: CalendarClock },
  { to: "/studio/$tab", params: { tab: "plugins" }, label: "Plugins", icon: Plug },
  { to: "/studio/$tab", params: { tab: "computer" }, label: "Computer", icon: MonitorSmartphone },
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/tasks", label: "Tasks", icon: KanbanSquare },
  { to: "/teams", label: "Teams", icon: Network },
  { to: "/artifacts", label: "Artifacts", icon: FileBox },
] as const;

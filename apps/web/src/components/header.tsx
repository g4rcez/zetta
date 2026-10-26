import { Link, useRouterState } from "@tanstack/react-router";
import { Blocks, CalendarClock, Gauge, MessagesSquare, MonitorSmartphone, Plug } from "lucide-react";

import { useAttentionSummary } from "@/features/attention/summary";
import { isRailTab } from "@/features/studio/studio-tabs";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export const APP_PREFIXES = ["/chat", "/studio", "/dashboard"];
export const inApp = (pathname: string) => APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const links = [
  { to: "/chat/{-$chatId}", label: "Chat", icon: MessagesSquare },
  { to: "/studio", label: "Studio", icon: Blocks },
  { to: "/studio/$tab", params: { tab: "routines" }, label: "Routines", icon: CalendarClock },
  { to: "/studio/$tab", params: { tab: "plugins" }, label: "Plugins", icon: Plug },
  { to: "/studio/$tab", params: { tab: "computer" }, label: "Computer", icon: MonitorSmartphone },
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
] as const;

const Brand = ({ small = false }: { small?: boolean }) => (
  <Link to="/" aria-label="Zetta home" className={`grid place-items-center rounded-md bg-primary font-bold text-primary-foreground shadow-sm ${small ? "size-7 text-sm" : "size-9 text-base"}`}>Z</Link>
);

/** Signed-in application shell: a slim icon rail on the left (bottom bar on phones). */
export function AppRail() {
  const attention = useAttentionSummary();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  return (
    <header className="z-10 flex shrink-0 items-center gap-1 border-b bg-sidebar p-2 md:w-16 md:flex-col md:border-r md:border-b-0 md:py-3">
      <Brand />
      <nav aria-label="Main" className="ml-2 flex flex-1 items-center gap-1 md:ml-0 md:mt-3 md:flex-col">
        {links.map((link) => {
          const { to, label, icon: Icon } = link;
          const params = "params" in link ? link.params : undefined;
          const target = params ? `/studio/${params.tab}` : to;
          const railTab = pathname.startsWith("/studio/") && isRailTab(pathname.split("/")[2] ?? "");
          const base = to.split("/{")[0]!;
          const active = to === "/studio" ? pathname.startsWith("/studio") && !railTab : params ? pathname === target : pathname === base || pathname.startsWith(`${base}/`);
          return (
            <Link key={target} to={to as string} params={params as never} aria-label={label} title={label} aria-current={active ? "page" : undefined}
              className={`relative grid size-10 place-items-center rounded-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"}`}>
              <Icon className="size-5" aria-hidden="true" />
              <span className="sr-only">{label}</span>
              {to === "/studio" && attention && attention.unread > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white" aria-label={`${attention.unread} unread attention items`}>{attention.unread}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-1 md:flex-col"><ModeToggle compact /><UserMenu compact /></div>
    </header>
  );
}

/** Public pages (home, sign in): a minimal top bar. */
export default function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2"><Brand small /><span className="text-sm font-semibold tracking-tight">Zetta</span></div>
      <div className="flex items-center gap-1"><ModeToggle inline /><UserMenu inline /></div>
    </header>
  );
}

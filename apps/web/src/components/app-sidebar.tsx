import { Link, useRouterState } from "@tanstack/react-router";
import {
  CaretRightIcon,
  HashIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  NotePencilIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Tooltip } from "@g4rcez/components/tooltip";
import { cn } from "@zetta/ui/lib/utils";

import { appLinks } from "@/components/app-links";
import { BotAvatar } from "@/components/bot-avatar";
import {
  useAttentionSummary,
  useBotAttention,
  useRoutineUnread,
} from "@/features/attention/summary";
import {
  SidebarTree,
  orderBots,
  useSidebarLocation,
  useSidebarNavigation,
} from "@/features/chat/sidebar";
import { useRooms, useSidebarData } from "@/features/chat/sidebar-data";
import { groupRooms, roomSignal } from "@/features/discussions/rooms";
import { SIDEBAR_LIMITS, usePreferences } from "@/features/preferences/preferences";
import { isRailTab } from "@/features/studio/studio-tabs";

import { Logo } from "./logo";
import { ModeToggle } from "./mode-toggle";
import { railLabel, railRow, railRowActive, railRowExpanded } from "./rail-row";
import { ResizeHandle } from "./resize-handle";
import UserMenu from "./user-menu";

type AppLink = (typeof appLinks)[number];
const linkOf = (label: AppLink["label"]) => appLinks.find((l) => l.label === label)!;
/** DESIGN.md "Sidebar structure": the daily destinations stay fixed on top; building and oversight sit under More. */
const FIXED = [linkOf("Inbox"), linkOf("Tasks"), linkOf("Routines"), linkOf("Memory")];
const MORE = [
  linkOf("Agenda"),
  linkOf("Studio"),
  linkOf("Plugins"),
  linkOf("Skills"),
  linkOf("Computer"),
  linkOf("Dashboard"),
  linkOf("Teams"),
  linkOf("Artifacts"),
];
const MORE_KEY = "zetta.sidebar-more";
const RAIL_WIDTH = 48;

function isActive(link: AppLink, pathname: string) {
  const params = "params" in link ? link.params : undefined;
  if (link.to === "/studio") {
    const railTab = pathname.startsWith("/studio/") && isRailTab(pathname.split("/")[2] ?? "");
    return pathname.startsWith("/studio") && !railTab;
  }
  if (params)
    return (
      pathname === `/studio/${params.tab}` ||
      (params.tab === "plugins" && pathname.startsWith("/plugins/"))
    );
  const base = link.to.split("/{")[0]!;
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** When the sidebar is collapsed, hovering or focusing an item shows its name beside it. */
function RailHint({
  collapsed,
  label,
  icon,
  children,
}: {
  collapsed: boolean;
  label: string;
  icon: ReactNode;
  children: ReactElement;
}) {
  if (!collapsed) return children;
  return (
    <Tooltip as="div" className="block" title={children} placement="right" popover={false}>
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </span>
    </Tooltip>
  );
}

function NavRow({
  link,
  collapsed,
  badge,
}: {
  link: AppLink;
  collapsed: boolean;
  badge?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = isActive(link, pathname);
  const params = "params" in link ? link.params : undefined;
  const Icon = link.icon;
  return (
    <RailHint
      collapsed={collapsed}
      label={link.label}
      icon={<Icon className="size-4" aria-hidden="true" />}
    >
      <Link
        to={link.to as string}
        params={params as never}
        aria-current={active ? "page" : undefined}
        className={cn(railRow, !collapsed && railRowExpanded, active && railRowActive)}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className={collapsed ? "sr-only" : railLabel}>{link.label}</span>
        {badge}
      </Link>
    </RailHint>
  );
}

/** A count on a nav row: a dot when the rail is collapsed, a pill when it is open. Amber is only for "a person is needed" (DESIGN.md "The Attention Rule"). */
function CountBadge({
  collapsed,
  count,
  tone,
}: {
  collapsed: boolean;
  count: number;
  tone: "attention" | "quiet";
}) {
  if (!count) return null;
  const label = <span className="sr-only">({count} unread)</span>;
  if (collapsed)
    return (
      <>
        {label}
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1 right-1 size-2 rounded-full border border-sidebar",
            tone === "attention" ? "bg-attention" : "bg-muted-foreground",
          )}
        />
      </>
    );
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 text-xs leading-5 font-medium tabular-nums",
        tone === "attention"
          ? "bg-attention text-attention-foreground"
          : "bg-sidebar-accent text-sidebar-foreground",
      )}
    >
      {label}
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
    </span>
  );
}

/** Inbox count: amber, because it means a person is needed. */
function InboxBadge({ collapsed }: { collapsed: boolean }) {
  const attention = useAttentionSummary();
  return <CountBadge collapsed={collapsed} count={attention?.unread ?? 0} tone="attention" />;
}

/** Routine runs not opened yet: quiet, a result to read and not a request. */
function RoutinesBadge({ collapsed }: { collapsed: boolean }) {
  return <CountBadge collapsed={collapsed} count={useRoutineUnread()} tone="quiet" />;
}

/** The collapsed rail shows each bot as its avatar, in the same order as the full sidebar, with the attention dot kept. */
function RailBots() {
  const { bots } = useSidebarData();
  const { preferences } = usePreferences();
  const attention = useBotAttention();
  const { botId } = useSidebarLocation();
  const { toBot } = useSidebarNavigation();
  const { chief, rest } = orderBots(bots, preferences.botOrder);
  const list = chief ? [chief, ...rest] : rest;
  return (
    <ul aria-label="Bots" className="flex flex-col items-center gap-px">
      {list.map((b) => {
        const needs = !!attention.get(b.id)?.unread;
        const blocked = !b.canEdit && !b.onboarded;
        return (
          <li key={b.id}>
            <RailHint collapsed label={b.name} icon={<BotAvatar bot={b} size={16} />}>
              <button
                type="button"
                disabled={blocked}
                aria-current={b.id === botId ? "page" : undefined}
                onClick={() => toBot(b.id)}
                className={cn(railRow, b.id === botId && railRowActive, "disabled:opacity-50")}
              >
                <BotAvatar bot={b} size={20} />
                <span className="sr-only">
                  {b.name}
                  {needs ? ", needs you" : ""}
                </span>
                {needs && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 size-2 rounded-full border border-sidebar bg-attention"
                  />
                )}
              </button>
            </RailHint>
          </li>
        );
      })}
    </ul>
  );
}

/** The collapsed rail's way into rooms; the amber dot keeps "a room needs you" visible when the room list is hidden. */
function RailRooms() {
  const { rooms } = useRooms();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const waiting = useMemo(() => {
    const { rooms: live, issues } = groupRooms(rooms ?? []);
    return [...live, ...issues].filter((d) => roomSignal(d) === "needs-you").length;
  }, [rooms]);
  const active = pathname === "/rooms" || pathname.startsWith("/rooms/");
  return (
    <RailHint collapsed label="Rooms" icon={<HashIcon className="size-4" aria-hidden="true" />}>
      <Link
        to="/rooms"
        search={{}}
        aria-current={active ? "page" : undefined}
        className={cn(railRow, active && railRowActive)}
      >
        <HashIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">
          Rooms{waiting ? `, ${waiting} ${waiting === 1 ? "needs" : "need"} you` : ""}
        </span>
        {waiting > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 size-2 rounded-full border border-sidebar bg-attention"
          />
        )}
      </Link>
    </RailHint>
  );
}

function readMore() {
  try {
    return localStorage.getItem(MORE_KEY) === "open";
  } catch {
    return false;
  }
}

/** Studio, Dashboard and the other building and oversight pages: closed by default, open while one of them is shown. */
function MoreGroup() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(readMore);
  const here = MORE.some((l) => isActive(l, pathname));
  const shown = open || here;
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(MORE_KEY, o ? "closed" : "open");
      } catch {
        // Storage unavailable: the choice lasts for this session.
      }
      return !o;
    });
  return (
    <section aria-label="More">
      <div className="pt-3 pb-1 pl-1">
        <button
          type="button"
          aria-expanded={shown}
          onClick={toggle}
          className="label-mono flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <CaretRightIcon
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 transition-transform motion-reduce:transition-none",
              shown && "rotate-90",
            )}
          />
          More
        </button>
      </div>
      {shown && (
        <ul className="space-y-px">
          {MORE.map((l) => (
            <li key={l.label}>
              <NavRow link={l} collapsed={false} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The one app sidebar (DESIGN.md "Shell"): workspace row, the fixed block, rooms, the bot tree and More, then the account.
 * `collapsed` is the 48px rail of icons and bot avatars; `mobile` drops the resize and collapse controls (it lives in a sheet).
 */
export function AppSidebar({
  onSearch,
  mobile = false,
}: {
  onSearch: () => void;
  mobile?: boolean;
}) {
  const { preferences, set } = usePreferences();
  const { bots } = useSidebarData();
  const { botId } = useSidebarLocation();
  const { toDraft } = useSidebarNavigation();
  const collapsed = !mobile && preferences.railMode === "collapsed";
  const newChatBot = botId ?? bots.find((b) => b.kind === "chief")?.id;
  const newChatName = (newChatBot && bots.find((b) => b.id === newChatBot)?.name) || "your chief";
  const rail = collapsed ? "collapsed" : "expanded";
  const iconButton = cn(railRow, "w-8");
  return (
    <aside
      aria-label="Sidebar"
      style={mobile ? undefined : { width: collapsed ? RAIL_WIDTH : preferences.railWidth }}
      className={cn(
        "relative flex h-full min-h-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        mobile && "w-full",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 gap-1 px-2",
          collapsed ? "flex-col items-center py-2" : "h-12 items-center",
        )}
      >
        <Link
          to="/"
          aria-label="Zetta home"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Logo size={collapsed ? 24 : 20} tile />
          {!collapsed && <span className="truncate text-sm font-semibold">Zetta</span>}
        </Link>
        <RailHint
          collapsed={collapsed}
          label="Search"
          icon={<MagnifyingGlassIcon className="size-4" aria-hidden="true" />}
        >
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search"
            aria-keyshortcuts="Meta+K Control+K"
            title={collapsed ? undefined : "Search (⌘K)"}
            className={iconButton}
          >
            <MagnifyingGlassIcon className="size-4" aria-hidden="true" />
          </button>
        </RailHint>
        {newChatBot && (
          <RailHint
            collapsed={collapsed}
            label="New chat"
            icon={<NotePencilIcon className="size-4" aria-hidden="true" />}
          >
            <button
              type="button"
              onClick={() => toDraft(newChatBot)}
              aria-label={`New chat with ${newChatName}`}
              title={collapsed ? undefined : `New chat with ${newChatName}`}
              className={iconButton}
            >
              <NotePencilIcon className="size-4" aria-hidden="true" />
            </button>
          </RailHint>
        )}
      </div>
      <nav
        aria-label="Main"
        className={cn("shrink-0 space-y-px px-2", collapsed && "flex flex-col items-center")}
      >
        {FIXED.map((l) => (
          <NavRow
            key={l.label}
            link={l}
            collapsed={collapsed}
            badge={
              l.label === "Inbox" ? (
                <InboxBadge collapsed={collapsed} />
              ) : l.label === "Routines" ? (
                <RoutinesBadge collapsed={collapsed} />
              ) : undefined
            }
          />
        ))}
      </nav>
      {collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-2 py-2">
          <span aria-hidden="true" className="h-px w-6 shrink-0 bg-sidebar-border" />
          <RailRooms />
          <RailBots />
          <span aria-hidden="true" className="h-px w-6 shrink-0 bg-sidebar-border" />
          <nav aria-label="More" className="flex flex-col items-center gap-px">
            {MORE.map((l) => (
              <NavRow key={l.label} link={l} collapsed />
            ))}
          </nav>
        </div>
      ) : (
        <SidebarTree>
          <MoreGroup />
        </SidebarTree>
      )}
      <div
        className={cn(
          "shrink-0 space-y-px border-t border-sidebar-border p-2",
          collapsed && "flex flex-col items-center",
        )}
      >
        <RailHint
          collapsed={collapsed}
          label="Theme"
          icon={<MoonIcon className="size-4" aria-hidden="true" />}
        >
          <ModeToggle rail={rail} />
        </RailHint>
        {!mobile && (
          <RailHint
            collapsed={collapsed}
            label="Expand sidebar"
            icon={<SidebarSimpleIcon className="size-4" aria-hidden="true" />}
          >
            <button
              type="button"
              onClick={() => set({ railMode: collapsed ? "expanded" : "collapsed" })}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className={cn(railRow, !collapsed && railRowExpanded)}
            >
              <SidebarSimpleIcon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className={railLabel}>Collapse</span>}
            </button>
          </RailHint>
        )}
        <UserMenu rail={rail} />
      </div>
      {!mobile && !collapsed && (
        <ResizeHandle
          label="Resize sidebar"
          value={preferences.railWidth}
          {...SIDEBAR_LIMITS.railWidth}
          onChange={(railWidth) => set({ railWidth })}
        />
      )}
    </aside>
  );
}

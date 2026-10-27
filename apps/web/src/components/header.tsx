import { Link, useRouterState } from "@tanstack/react-router";
import { Moon, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { Tooltip } from "@g4rcez/components/tooltip";

import { appLinks } from "@/components/app-links";
import { useAttentionSummary } from "@/features/attention/summary";
import { AppCommandPalette } from "@/features/command-palette/app-command-palette";
import { isRailTab } from "@/features/studio/studio-tabs";

import { railLabel, railRow, railRowActive, railRowExpanded } from "./rail-row";
import { Logo } from "./logo";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export const APP_PREFIXES = ["/chat", "/discussions", "/agenda", "/tasks", "/studio", "/dashboard"];
export const inApp = (pathname: string) =>
  APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const Brand = ({ small = false }: { small?: boolean }) => (
  <Link to="/" aria-label="Zetta home" className="grid shrink-0 place-items-center">
    <Logo size={small ? 28 : 36} />
  </Link>
);

const COLLAPSED_KEY = "zetta:rail-collapsed";
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

/** When the rail is collapsed, hovering or focusing the item shows its icon and title beside it. */
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

/** Signed-in application shell: a slim icon rail on the left (bottom bar on phones). */
export function AppRail() {
  const attention = useAttentionSummary();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () =>
    setCollapsed((current) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1");
      } catch {
        // storage unavailable: the preference just won't persist
      }
      return !current;
    });
  const expanded = !collapsed;
  return (
    <motion.header
      initial={false}
      animate={{ "--rail-w": expanded ? "14rem" : "4rem" }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      className={`z-10 flex shrink-0 items-center gap-1 overflow-hidden border-b bg-sidebar p-2 md:w-(--rail-w) md:flex-col md:border-r md:border-b-0 md:py-3 ${expanded ? "md:items-stretch" : ""}`}
    >
      <div
        className={`flex items-center gap-2 ${expanded ? "md:justify-between md:pl-0.5" : "md:flex-col"}`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Brand />
          {expanded ? (
            <span className="hidden truncate text-sm font-semibold tracking-tight md:inline">
              Zetta
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={expanded}
          className="hidden size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring md:grid"
        >
          {expanded ? (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <nav
        aria-label="Main"
        className="ml-2 flex flex-1 items-center gap-1 md:ml-0 md:mt-3 md:flex-col md:items-stretch"
      >
        {appLinks.map((link) => {
          const { to, label, icon: Icon } = link;
          const params = "params" in link ? link.params : undefined;
          const target = params ? `/studio/${params.tab}` : to;
          const railTab =
            pathname.startsWith("/studio/") && isRailTab(pathname.split("/")[2] ?? "");
          const base = to.split("/{")[0]!;
          const active =
            to === "/studio"
              ? pathname.startsWith("/studio") && !railTab
              : params
                ? pathname === target
                : pathname === base || pathname.startsWith(`${base}/`);
          return (
            <RailHint
              key={target}
              collapsed={collapsed}
              label={label}
              icon={<Icon className="size-4" aria-hidden="true" />}
            >
              <Link
                to={to as string}
                params={params as never}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={`${railRow} ${expanded ? railRowExpanded : ""} ${active ? railRowActive : ""}`}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="sr-only md:hidden">{label}</span>
                {expanded ? (
                  <span className={railLabel} aria-hidden="true">
                    {label}
                  </span>
                ) : null}
                {to === "/studio" && attention && attention.unread > 0 ? (
                  <span
                    className="absolute top-0.5 left-6 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white"
                    aria-label={`${attention.unread} unread attention items`}
                  >
                    {attention.unread}
                  </span>
                ) : null}
              </Link>
            </RailHint>
          );
        })}
      </nav>
      <div className="flex items-center gap-1 md:w-full md:flex-col md:items-stretch">
        <RailHint
          collapsed={collapsed}
          label="Search"
          icon={<Search className="size-4" aria-hidden="true" />}
        >
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search commands"
            aria-keyshortcuts="Meta+K Control+K"
            className={`${railRow} ${expanded ? railRowExpanded : ""} hidden md:flex`}
          >
            <Search className="size-5 shrink-0" aria-hidden="true" />
            {expanded ? (
              <>
                <span className={railLabel}>Search</span>
                <kbd className="ml-auto hidden text-xs font-normal md:inline">⌘K</kbd>
              </>
            ) : null}
          </button>
        </RailHint>
        <RailHint
          collapsed={collapsed}
          label="Theme"
          icon={<Moon className="size-4" aria-hidden="true" />}
        >
          <ModeToggle rail={expanded ? "expanded" : "collapsed"} />
        </RailHint>
        <UserMenu rail={expanded ? "expanded" : "collapsed"} />
      </div>
      <AppCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </motion.header>
  );
}

/** Public pages (home, sign in): a minimal top bar. */
export default function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2">
        <Brand small />
        <span className="text-sm font-semibold tracking-tight">Zetta</span>
      </div>
      <div className="flex items-center gap-1">
        <ModeToggle inline />
        <UserMenu inline />
      </div>
    </header>
  );
}

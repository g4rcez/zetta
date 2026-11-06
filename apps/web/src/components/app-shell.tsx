import { Link, useRouterState } from "@tanstack/react-router";
import { ListIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@zetta/ui/components/sheet";

import { useBackgroundNotifications } from "@/features/attention/background-notifications";
import { PausedBanner } from "@/features/agents/pause-agents";
import { useSidebarSide } from "@/features/preferences/preferences";
import { AppCommandPalette } from "@/features/command-palette/app-command-palette";

import { AppSidebar } from "./app-sidebar";
import { Logo } from "./logo";
import { railRow } from "./rail-row";

const DESKTOP = "(min-width: 768px)";
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const isDesktop = () => window.matchMedia(DESKTOP).matches;

/**
 * The signed-in app frame (DESIGN.md "Shell"): one sidebar on the `--sidebar` ground and the page in one inset panel. Below
 * 768px the panel fills the screen and the sidebar opens as a sheet from a 48px top bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const side = useSidebarSide();
  const desktop = useSyncExternalStore(subscribe, isDesktop, () => true);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useBackgroundNotifications();
  // A route change closes the phone sheet, so a tap on a row lands on its page.
  useEffect(() => setNavOpen(false), [pathname]);
  const search = useCallback(() => {
    setNavOpen(false);
    setPaletteOpen(true);
  }, []);
  return (
    // The sidebar stays first in the DOM (tab order, screen readers); on the right it is only laid out last.
    <div
      className={`flex h-svh flex-col overflow-clip bg-sidebar text-sidebar-foreground ${side === "right" ? "md:flex-row-reverse" : "md:flex-row"}`}
    >
      {desktop ? (
        <AppSidebar onSearch={search} />
      ) : (
        <>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-2">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
              className={`${railRow} w-8`}
            >
              <ListIcon className="size-4" aria-hidden="true" />
            </button>
            <Link
              to="/"
              aria-label="Zetta home"
              className="flex items-center gap-2 rounded-md px-1 py-1 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Logo size={20} tile />
              <span className="text-sm font-semibold">Zetta</span>
            </Link>
          </header>
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent
              side={side}
              showCloseButton={false}
              className="w-72 max-w-[85vw] bg-sidebar p-0 text-sm text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <AppSidebar mobile onSearch={search} />
            </SheetContent>
          </Sheet>
        </>
      )}
      <main
        className={`min-h-0 min-w-0 flex-1 overflow-y-auto bg-background text-foreground md:my-2 ${side === "right" ? "md:ml-2" : "md:mr-2"} md:rounded-xl md:border md:border-border`}
      >
        <PausedBanner />
        {children}
      </main>
      <AppCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

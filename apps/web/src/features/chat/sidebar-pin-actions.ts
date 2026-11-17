import { useMemo } from "react";

import { usePreferences } from "../preferences/preferences";
import { pickSidebarBots, rankBots } from "./sidebar-bot-list";
import { useSidebarData } from "./sidebar-data";
import { nextPins } from "./sidebar-pins";

/**
 * Which bots are in the chat sidebar, and the way to add or remove one. Used by the Bots page and the sidebar's own rows, so both say the
 * same and write the same preference (`sidebarBots`).
 */
export function useSidebarPins(currentId?: string) {
  const { bots, chats } = useSidebarData();
  const { preferences, set } = usePreferences();
  const shown = useMemo(
    () =>
      pickSidebarBots(bots, chats, {
        order: preferences.botOrder,
        pinned: preferences.sidebarBots,
        currentId,
      }).shown,
    [bots, chats, preferences.botOrder, preferences.sidebarBots, currentId],
  );
  const inSidebar = useMemo(() => new Set(shown.map((b) => b.id)), [shown]);
  // The sidebar's own order for the bots on screen, then the rest in the order the sidebar would rank them.
  const ordered = useMemo(() => {
    const rest = rankBots(bots, chats, preferences.botOrder).filter((b) => !shown.includes(b));
    return [...shown, ...rest].filter((b) => b.kind !== "chief");
  }, [bots, chats, preferences.botOrder, shown]);
  return {
    inSidebar,
    /** Every bot but the chief: first the ones on screen, in the sidebar's order, then the others. */
    ordered,
    /** True when the person chose bots; false while the sidebar picks by itself. */
    pinned: preferences.sidebarBots.length > 0,
    /** Forgets the choice: the sidebar picks by itself again. */
    reset: () => set({ sidebarBots: [] }),
    /** Adds the bot to the sidebar (`on`) or takes it out. */
    setPinned: (id: string, on: boolean) =>
      set({ sidebarBots: nextPins(bots, preferences.sidebarBots, shown, id, on) }),
  };
}

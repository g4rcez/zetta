import { useMemo } from "react";

import { usePreferences } from "../preferences/preferences";
import { pickSidebarBots } from "./sidebar-bot-list";
import { useSidebarData } from "./sidebar-data";
import { nextPins } from "./sidebar-pins";

/**
 * Which bots are in the chat sidebar, and the way to add or remove one. Used by the Bots page and the sidebar's own rows, so both say the
 * same and write the same preference (`sidebarBots`).
 */
export function useSidebarPins() {
  const { bots, chats } = useSidebarData();
  const { preferences, set } = usePreferences();
  const shown = useMemo(
    () =>
      pickSidebarBots(bots, chats, {
        order: preferences.botOrder,
        pinned: preferences.sidebarBots,
      }).shown,
    [bots, chats, preferences.botOrder, preferences.sidebarBots],
  );
  const inSidebar = useMemo(() => new Set(shown.map((b) => b.id)), [shown]);
  return {
    inSidebar,
    /** Adds the bot to the sidebar (`on`) or takes it out. */
    setPinned: (id: string, on: boolean) =>
      set({ sidebarBots: nextPins(bots, preferences.sidebarBots, shown, id, on) }),
  };
}
